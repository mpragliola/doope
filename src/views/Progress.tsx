import { useEffect, useRef } from 'react';
import type { ViewName } from '../App';
import { Toolbar } from '../components/Toolbar';
import { ProgressBar } from '../components/ProgressBar';
import { ExtBadges } from '../components/ExtBadges';
import { useProgressStore } from '../stores/useProgressStore';
import { api } from '../api';
import type { ProgressEvent } from '../types';

interface ProgressProps {
  active: boolean;
  onNavigate: (v: ViewName) => void;
}

export function Progress({ active, onNavigate }: ProgressProps) {
  const store = useProgressStore();
  const pendingRef = useRef<ProgressEvent | null>(null);
  const rafRef = useRef<number>(0);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!active) return;

    store.reset();
    pendingRef.current = null;

    function flush() {
      rafRef.current = 0;
      const evt = pendingRef.current;
      if (!evt) return;
      pendingRef.current = null;
      store.applyEvent(evt);
    }

    api.onProgress((evt) => {
      if (evt.phase === 'done') {
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
        unlistenRef.current?.();
        unlistenRef.current = null;
        onNavigate('results');
        window.dispatchEvent(new CustomEvent('scan-complete'));
        return;
      }
      if (evt.phase === 'walking') {
        store.applyEvent(evt);
        return;
      }
      pendingRef.current = evt;
      if (!rafRef.current) rafRef.current = requestAnimationFrame(flush);
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [active]);

  async function cancel() {
    await api.cancelScan();
    unlistenRef.current?.();
    unlistenRef.current = null;
    onNavigate('results');
    window.dispatchEvent(new CustomEvent('scan-complete'));
  }

  const { phase, current, total, path, cachedCount, extCounts, etaInfo } = store;
  const isWalking = phase === 'walking';
  const isGrouping = phase === 'grouping';
  const pct = total > 0 ? (current / total) * 100 : 0;
  const cachedStr = cachedCount > 0 ? ` · ${cachedCount.toLocaleString()} cached` : '';

  let phaseLabel = 'Initializing…';
  if (isWalking) phaseLabel = total > 0 ? `Found ${total.toLocaleString()} files, loading cache…` : 'Scanning folders…';
  else if (phase === 'hashing') phaseLabel = 'Hashing…';
  else if (isGrouping) phaseLabel = 'Grouping duplicates…';

  let countLabel = '';
  if (phase === 'hashing') countLabel = `${current.toLocaleString()} / ${total.toLocaleString()}${cachedStr}`;

  return (
    <div className={active ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>
      <Toolbar>
        <h1 className="flex-1 text-[17px] font-semibold tracking-tight">Scanning…</h1>
        <button
          className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-4 py-2 text-sm hover:bg-[#333]"
          onClick={cancel}
        >
          Cancel
        </button>
      </Toolbar>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-10">
        <div className="w-full max-w-[600px]">
          <div className="flex justify-between mb-2 text-[13px]">
            <span>{phaseLabel}</span>
            <span>{countLabel}</span>
          </div>
          <ProgressBar pct={isGrouping ? 100 : pct} indeterminate={isWalking} />
          <div className="mt-2 text-[12px] text-[#666] min-h-4">
            {etaInfo ? `${etaInfo.rate} · ETA ${etaInfo.eta}` : ''}
          </div>
        </div>
        <div
          className="text-[#555] max-w-[600px] overflow-hidden text-ellipsis whitespace-nowrap w-full"
          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}
        >
          {path}
        </div>
        <ExtBadges extCounts={extCounts} />
      </div>
    </div>
  );
}
