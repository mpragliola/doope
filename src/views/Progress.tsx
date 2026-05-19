import { useState, useEffect } from 'react';
import type { ViewName } from '../App';
import { Toolbar } from '../components/Toolbar';
import { ProgressBar } from '../components/ProgressBar';
import { ExtBadges } from '../components/ExtBadges';
import { useProgressStore } from '../stores/useProgressStore';
import { useProgressListener } from '../hooks/useProgressListener';
import { api } from '../api';

interface ProgressProps {
  active: boolean;
  onNavigate: (v: ViewName) => void;
}

export function Progress({ active, onNavigate }: ProgressProps) {
  const { cancel } = useProgressListener(active, onNavigate);
  const { phase, current, total, path, cachedCount, extCounts, etaInfo } = useProgressStore();

  const [priority, setPriority] = useState<number>(() =>
    Number(localStorage.getItem('scan_priority') ?? '1')
  );

  useEffect(() => {
    api.setScanPriority(priority);
  }, [priority]);

  const isWalking = phase === 'walking';
  const isGrouping = phase === 'grouping';
  const pct = total > 0 ? (current / total) * 100 : 0;
  const cachedStr = cachedCount > 0 ? ` · ${cachedCount.toLocaleString()} cached` : '';

  let phaseLabel = 'Initializing…';
  if (isWalking) phaseLabel = total > 0 ? `Found ${total.toLocaleString()} files, loading cache…` : 'Scanning folders…';
  else if (phase === 'hashing') phaseLabel = 'Hashing…';
  else if (isGrouping) phaseLabel = 'Grouping duplicates…';

  const countLabel = phase === 'hashing'
    ? `${current.toLocaleString()} / ${total.toLocaleString()}${cachedStr}`
    : '';

  return (
    <div className={active ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>
      <Toolbar>
        <h1 className="flex-1 text-[17px] font-semibold tracking-tight">Scanning…</h1>
        <select
          value={priority}
          onChange={e => {
            const v = Number(e.target.value);
            localStorage.setItem('scan_priority', String(v));
            setPriority(v);
          }}
          className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-3 py-2 text-sm"
        >
          <option value={0}>Aggressive</option>
          <option value={1}>Balanced</option>
          <option value={2}>Low impact</option>
        </select>
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
