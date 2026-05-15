import { api } from '../api';
import { navigate } from '../main';
import type { ProgressEvent } from '../types';

let unlisten: (() => void) | null = null;

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
      </div>
      <div id="current-path" style="font-size:11px;color:#666;max-width:600px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%"></div>
    </div>
  `;

  el.querySelector('#btn-cancel')!.addEventListener('click', cancel);
}

export async function activateProgress() {
  const bar = document.getElementById('progress-bar')!;
  const phaseLabel = document.getElementById('phase-label')!;
  const countLabel = document.getElementById('count-label')!;
  const currentPath = document.getElementById('current-path')!;

  bar.style.width = '0%';
  phaseLabel.textContent = 'Hashing…';
  countLabel.textContent = '';
  currentPath.textContent = '';

  if (unlisten) { unlisten(); unlisten = null; }

  unlisten = await api.onProgress((evt: ProgressEvent) => {
    if (evt.phase === 'hashing') {
      const pct = evt.total > 0 ? (evt.current / evt.total) * 100 : 0;
      bar.style.width = `${pct}%`;
      phaseLabel.textContent = 'Hashing…';
      countLabel.textContent = `${evt.current.toLocaleString()} / ${evt.total.toLocaleString()}`;
      currentPath.textContent = evt.path;
    } else if (evt.phase === 'grouping') {
      bar.style.width = '100%';
      phaseLabel.textContent = 'Grouping duplicates…';
      countLabel.textContent = '';
      currentPath.textContent = '';
    } else if (evt.phase === 'done') {
      if (unlisten) { unlisten(); unlisten = null; }
      navigate('results');
      window.dispatchEvent(new CustomEvent('scan-complete'));
    }
  });
}

async function cancel() {
  await api.cancelScan();
  if (unlisten) { unlisten(); unlisten = null; }
  navigate('results');
  window.dispatchEvent(new CustomEvent('scan-complete'));
}
