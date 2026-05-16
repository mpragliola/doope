import { api } from '../api';
import { navigate } from '../main';
import type { ProgressEvent } from '../types';

let unlisten: (() => void) | null = null;
const extCounts = new Map<string, number>();
let maxCached = 0;

// EMA-based ETA: smooth exponential moving average of files/sec rate.
const EMA_ALPHA = 0.15; // lower = smoother but slower to react

function makeEtaTracker() {
  let emaRate = 0;
  let lastT = 0;
  let lastN = 0;
  let hasRate = false;
  return {
    reset() { emaRate = 0; lastT = 0; lastN = 0; hasRate = false; },
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
    },
    compute(current: number, total: number): { eta: string; rate: string } | null {
      if (!hasRate || emaRate <= 0) return null;
      const remaining = total - current;
      const etaSec = remaining / emaRate;
      return { eta: formatDuration(etaSec), rate: `${Math.round(emaRate)} files/sec` };
    },
  };
}

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

export function renderProgress(el: HTMLElement) {
  el.innerHTML = `
    <div class="toolbar">
      <h1>Scanning…</h1>
      <button class="ghost" id="btn-cancel">Cancel</button>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:40px">
      <div style="width:100%;max-width:600px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px">
          <span id="phase-label">Initializing…</span>
          <span id="count-label"></span>
        </div>
        <div style="background:#1e1e1e;border-radius:8px;height:12px;overflow:hidden">
          <div id="progress-bar" style="height:100%;background:#3b82f6;width:0%;transition:width 0.1s"></div>
        </div>
        <div id="eta-label" style="margin-top:8px;font-size:12px;color:#666;min-height:16px"></div>
      </div>
      <div id="current-path" class="mono" style="color:#555;max-width:600px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%"></div>
      <div id="ext-badges" style="display:flex;flex-wrap:wrap;gap:6px;max-width:600px;width:100%;min-height:22px"></div>
    </div>
  `;

  el.querySelector('#btn-cancel')!.addEventListener('click', cancel);
}

const eta = makeEtaTracker();

const EXT_PALETTE = [
  '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa',
  '#f472b6', '#22d3ee', '#a3e635', '#fb923c', '#818cf8',
  '#2dd4bf', '#e879f9', '#facc15', '#4ade80', '#f43f5e',
  '#38bdf8',
];
const extColorMap = new Map<string, string>();
let extColorIdx = 0;

function extColor(e: string): string {
  if (!extColorMap.has(e)) {
    extColorMap.set(e, EXT_PALETTE[extColorIdx % EXT_PALETTE.length]);
    extColorIdx++;
  }
  return extColorMap.get(e)!;
}

function renderExtBadges() {
  const el = document.getElementById('ext-badges');
  if (!el) return;
  const sorted = [...extCounts.entries()].sort((a, b) => b[1] - a[1]);
  el.innerHTML = sorted.map(([ext, count]) => {
    const color = extColor(ext);
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;font-size:10px;border:1px solid ${color};border-radius:10px;background:#1a1a1a;color:${color}">
      ${ext} <span style="color:#888">${count}</span>
    </span>`;
  }).join('');
}

export async function activateProgress() {
  const bar = document.getElementById('progress-bar')!;
  const phaseLabel = document.getElementById('phase-label')!;
  const countLabel = document.getElementById('count-label')!;
  const currentPath = document.getElementById('current-path')!;
  const etaLabel = document.getElementById('eta-label')!;

  bar.style.width = '0%';
  phaseLabel.textContent = 'Scanning folders…';
  countLabel.textContent = '';
  currentPath.textContent = '';
  etaLabel.textContent = '';
  eta.reset();
  extCounts.clear();
  extColorMap.clear();
  extColorIdx = 0;
  maxCached = 0;
  renderExtBadges();

  if (unlisten) { unlisten(); unlisten = null; }

  // Buffer the latest event and flush via rAF — caps DOM updates at 60fps regardless
  // of how fast Rust fires events, preventing IPC backlog from stalling the UI.
  let pending: ProgressEvent | null = null;
  let rafId = 0;

  function flush() {
    rafId = 0;
    const evt = pending;
    if (!evt) return;
    pending = null;

    if (evt.phase === 'hashing') {
      const pct = evt.total > 0 ? (evt.current / evt.total) * 100 : 0;
      bar.style.width = `${pct}%`;
      phaseLabel.textContent = 'Hashing…';
      if (evt.cached != null && evt.cached > maxCached) maxCached = evt.cached;
      const cachedStr = maxCached > 0 ? ` · ${maxCached.toLocaleString()} cached` : '';
      countLabel.textContent = `${evt.current.toLocaleString()} / ${evt.total.toLocaleString()}${cachedStr}`;
      currentPath.textContent = evt.path;
      renderExtBadges();
      eta.record(evt.current);
      const info = eta.compute(evt.current, evt.total);
      etaLabel.textContent = info ? `${info.rate} · ETA ${info.eta}` : '';
    } else if (evt.phase === 'grouping') {
      bar.style.width = '100%';
      phaseLabel.textContent = 'Grouping duplicates…';
      countLabel.textContent = '';
      currentPath.textContent = '';
      etaLabel.textContent = '';
    }
  }

  unlisten = await api.onProgress((evt: ProgressEvent) => {
    if (evt.phase === 'walking') {
      phaseLabel.textContent = 'Scanning folders…';
      countLabel.textContent = '';
      currentPath.textContent = '';
      etaLabel.textContent = '';
      return;
    }

    if (evt.phase === 'done') {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (unlisten) { unlisten(); unlisten = null; }
      navigate('results');
      window.dispatchEvent(new CustomEvent('scan-complete'));
      return;
    }

    // Accumulate extension counts on every event (cheap), but defer rendering.
    if (evt.phase === 'hashing' && evt.path) {
      const dot = evt.path.lastIndexOf('.');
      const ext = dot >= 0 ? evt.path.slice(dot).toLowerCase() : '(none)';
      extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
    }

    pending = evt;
    if (!rafId) rafId = requestAnimationFrame(flush);
  });
}

async function cancel() {
  await api.cancelScan();
  if (unlisten) { unlisten(); unlisten = null; }
  navigate('results');
  window.dispatchEvent(new CustomEvent('scan-complete'));
}
