import { create } from 'zustand';
import type { Phase, ProgressEvent } from '../types';

const EMA_ALPHA = 0.1;
const WINDOW_SEC = 30;

type EtaTracker = {
  reset: () => void;
  record: (n: number) => void;
  compute: (current: number, total: number) => { eta: string; rate: string } | null;
};

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function makeEtaTracker(): EtaTracker {
  const samples: Array<{ t: number; n: number }> = [];
  let emaRate = 0;
  let lastT = 0;
  let lastN = 0;
  let hasRate = false;
  return {
    reset() { samples.length = 0; emaRate = 0; lastT = 0; lastN = 0; hasRate = false; },
    record(n: number) {
      const now = Date.now();
      if (lastT > 0) {
        const dt = (now - lastT) / 1000;
        const dn = n - lastN;
        if (dt > 0 && dn >= 0) {
          const instantRate = dn / dt;
          emaRate = hasRate ? EMA_ALPHA * instantRate + (1 - EMA_ALPHA) * emaRate : instantRate;
          hasRate = true;
        }
      }
      lastT = now;
      lastN = n;
      samples.push({ t: now, n });
      const cutoff = now - WINDOW_SEC * 1000;
      while (samples.length > 1 && samples[0].t < cutoff) samples.shift();
    },
    compute(current, total) {
      if (!hasRate || current <= 0 || samples.length < 2) return null;
      const oldest = samples[0];
      const newest = samples[samples.length - 1];
      const windowSec = (newest.t - oldest.t) / 1000;
      const windowRate = windowSec > 0 ? (newest.n - oldest.n) / windowSec : 0;
      if (windowRate <= 0) return null;
      const etaSec = (total - current) / windowRate;
      return { eta: formatDuration(etaSec), rate: `${Math.round(emaRate)} files/sec` };
    },
  };
}

interface ProgressState {
  phase: Phase | null;
  current: number;
  total: number;
  path: string;
  cachedCount: number;
  extCounts: Map<string, number>;
  etaInfo: { eta: string; rate: string } | null;
  _eta: EtaTracker;
  reset: () => void;
  applyEvent: (evt: ProgressEvent) => void;
}

export const useProgressStore = create<ProgressState>()((set, get) => ({
  phase: null,
  current: 0,
  total: 0,
  path: '',
  cachedCount: 0,
  extCounts: new Map(),
  etaInfo: null,
  _eta: makeEtaTracker(),
  reset: () => {
    get()._eta.reset();
    set({ phase: null, current: 0, total: 0, path: '', cachedCount: 0, extCounts: new Map(), etaInfo: null });
  },
  applyEvent: (evt) => {
    const { _eta, cachedCount, extCounts: prevCounts } = get();
    if (evt.phase === 'walking') {
      set({ phase: 'walking', total: evt.total, path: '', etaInfo: null });
      return;
    }
    if (evt.phase === 'grouping') {
      set({ phase: 'grouping', etaInfo: null });
      return;
    }
    if (evt.phase === 'hashing') {
      const extCounts = new Map(prevCounts);
      if (evt.ext_deltas) {
        for (const [rawExt, delta] of Object.entries(evt.ext_deltas)) {
          const ext = rawExt ? `.${rawExt}` : '(none)';
          extCounts.set(ext, (extCounts.get(ext) ?? 0) + delta);
        }
      } else if (evt.path) {
        const dot = evt.path.lastIndexOf('.');
        const ext = dot >= 0 ? evt.path.slice(dot).toLowerCase() : '(none)';
        extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
      }
      _eta.record(evt.current);
      const etaInfo = _eta.compute(evt.current, evt.total);
      set({
        phase: 'hashing',
        current: evt.current,
        total: evt.total,
        path: evt.path,
        cachedCount: Math.max(cachedCount, evt.cached ?? 0),
        extCounts,
        etaInfo,
      });
    }
  },
}));
