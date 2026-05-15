import { open } from '@tauri-apps/plugin-dialog';
import { api } from '../api';
import { navigate, showToast } from '../main';
import type { ScanOptions } from '../types';
import { setLastPhashThreshold } from '../scan-state';

const STORAGE_KEY = 'doope.folders';

let folders: string[] = [];
let priorities: string[] = [];

function loadPersistedFolders() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const { folders: f, priorities: p } = JSON.parse(raw);
      if (Array.isArray(f)) folders = f;
      if (Array.isArray(p)) priorities = p;
    }
  } catch { /* ignore corrupt storage */ }
}

function persistFolders() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ folders, priorities }));
}

export function renderScanConfig(el: HTMLElement) {
  el.innerHTML = `
    <div class="toolbar">
      <h1 style="display:flex;align-items:center;gap:9px">
        <svg width="22" height="26" viewBox="0 0 22 26" fill="none" aria-hidden="true">
          <rect x="6" y="0" width="15" height="19" rx="2.5"
                fill="#0f1e2e" stroke="#3b82f6" stroke-width="1.5" stroke-opacity="0.45"/>
          <rect x="1" y="5" width="15" height="19" rx="2.5" fill="#3b82f6"/>
          <rect x="4.5" y="10.5" width="7.5" height="1.8" rx="0.9" fill="rgba(255,255,255,0.82)"/>
          <rect x="4.5" y="14"   width="5.5" height="1.8" rx="0.9" fill="rgba(255,255,255,0.52)"/>
          <rect x="4.5" y="17.5" width="6.5" height="1.8" rx="0.9" fill="rgba(255,255,255,0.3)"/>
        </svg>
        Doope
      </h1>
      <button class="ghost" id="btn-clear-cache">Clear Cache</button>
    </div>
    <div style="display:flex;flex:1;overflow:hidden">
      <div style="width:340px;display:flex;flex-direction:column;border-right:1px solid #2a2a2a;padding:16px;gap:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="flex:1;font-weight:600">Folders</span>
          <button class="ghost" id="btn-add-folder" style="padding:5px 12px;font-size:12px">+ Add</button>
        </div>
        <ul id="folder-list" class="scroll-list" style="list-style:none;gap:4px;display:flex;flex-direction:column"></ul>

        <div style="margin-top:8px">
          <label>Folder Priority (drag to reorder)</label>
          <ul id="priority-list" class="scroll-list" style="list-style:none;gap:4px;display:flex;flex-direction:column;min-height:40px;border:1px solid #2a2a2a;border-radius:6px;padding:6px"></ul>
        </div>
      </div>

      <div style="flex:1;padding:24px;display:flex;flex-direction:column;gap:20px;overflow-y:auto">
        <div>
          <label>Scan Mode</label>
          <select id="sel-mode">
            <option value="both">Both (Filename + Content)</option>
            <option value="filename">Filename only (same name + size)</option>
            <option value="content">Content only (hash)</option>
          </select>
        </div>

        <div id="content-options">
          <label>Video Strategy</label>
          <div id="ffmpeg-warning" style="display:none;font-size:12px;color:#fbbf24;background:#1c1407;border:1px solid #78350f;border-radius:5px;padding:6px 10px;margin-bottom:6px">
            ⚠ ffmpeg not found — perceptual video strategies unavailable
          </div>
          <select id="sel-video">
            <option value="first_frame">First frame perceptual hash</option>
            <option value="exact_only">Exact hash only (fastest)</option>
            <option value="multi_frame">Multi-frame (8 frames, slowest)</option>
          </select>

          <div style="margin-top:16px">
            <label>Perceptual Similarity Threshold: <span id="lbl-threshold">8</span></label>
            <input type="range" id="slider-threshold" min="0" max="20" value="8" />
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#666;margin-top:2px">
              <span>Exact only (0)</span><span>Very similar (20)</span>
            </div>
          </div>
        </div>

        <div style="margin-top:auto">
          <button class="primary" id="btn-start" style="width:100%;padding:12px;font-size:15px" disabled>
            Select folders to scan
          </button>
        </div>
      </div>
    </div>
  `;

  loadPersistedFolders();
  renderFolderList();
  renderPriorityList();
  updateStartButton();
  wireEvents(el);
  checkFfmpeg();
}

async function checkFfmpeg() {
  let available: boolean;
  try {
    available = await api.checkFfmpeg();
  } catch (e) {
    showToast(`IPC broken: ${e}`, 'error');
    console.error('checkFfmpeg failed:', e);
    return;
  }
  if (!available) {
    const warning = document.getElementById('ffmpeg-warning')!;
    const sel = document.getElementById('sel-video') as HTMLSelectElement;
    warning.style.display = 'block';
    sel.querySelectorAll<HTMLOptionElement>('option').forEach(opt => {
      if (opt.value !== 'exact_only') opt.disabled = true;
    });
    sel.value = 'exact_only';
  }
}

function wireEvents(el: HTMLElement) {
  el.querySelector('#btn-add-folder')!.addEventListener('click', addFolder);
  el.querySelector('#btn-clear-cache')!.addEventListener('click', clearCache);
  el.querySelector('#btn-start')!.addEventListener('click', startScan);

  const modeSelect = el.querySelector<HTMLSelectElement>('#sel-mode')!;
  const contentOptions = el.querySelector<HTMLElement>('#content-options')!;
  modeSelect.addEventListener('change', () => {
    contentOptions.style.display = modeSelect.value === 'filename' ? 'none' : 'block';
  });

  const slider = el.querySelector<HTMLInputElement>('#slider-threshold')!;
  const lbl = el.querySelector<HTMLElement>('#lbl-threshold')!;
  slider.addEventListener('input', () => { lbl.textContent = slider.value; });
}

async function addFolder() {
  let selected: string | string[] | null;
  try {
    selected = await open({ multiple: true, directory: true });
  } catch (e) {
    showToast(String(e), 'error');
    console.error('dialog open failed:', e);
    return;
  }
  if (!selected) return;
  const newFolders = Array.isArray(selected) ? selected : [selected];
  for (const f of newFolders) {
    if (!folders.includes(f)) {
      folders.push(f);
      if (!priorities.includes(f)) priorities.push(f);
    }
  }
  persistFolders();
  renderFolderList();
  renderPriorityList();
  updateStartButton();
}

function renderFolderList() {
  const ul = document.getElementById('folder-list')!;
  ul.innerHTML = folders.map((f, i) => `
    <li style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:#1a1a1a;border-radius:4px;font-size:12px">
      <span class="mono" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${f}">${f}</span>
      <button class="ghost" data-idx="${i}" style="padding:2px 8px;font-size:11px">✕</button>
    </li>
  `).join('');
  ul.querySelectorAll('button[data-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt((btn as HTMLElement).dataset.idx!);
      const removed = folders.splice(idx, 1)[0];
      priorities = priorities.filter(p => p !== removed);
      persistFolders();
      renderFolderList();
      renderPriorityList();
      updateStartButton();
    });
  });
}

function renderPriorityList() {
  const ul = document.getElementById('priority-list')!;
  ul.innerHTML = priorities.map((f, i) => `
    <li draggable="true" data-idx="${i}"
        style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:#222;border-radius:4px;font-size:11px;cursor:grab">
      <span style="color:#666;margin-right:4px">${i + 1}.</span>
      <span class="mono" style="flex:1;overflow:hidden;text-overflow:ellipsis" title="${f}">${f}</span>
    </li>
  `).join('');

  let dragSrc = -1;
  ul.querySelectorAll('li').forEach(li => {
    li.addEventListener('dragstart', () => { dragSrc = parseInt(li.dataset.idx!); });
    li.addEventListener('dragover', e => { e.preventDefault(); });
    li.addEventListener('drop', () => {
      const dest = parseInt(li.dataset.idx!);
      if (dragSrc !== dest) {
        const [item] = priorities.splice(dragSrc, 1);
        priorities.splice(dest, 0, item);
        persistFolders();
        renderPriorityList();
      }
    });
  });
}

function updateStartButton() {
  const btn = document.getElementById('btn-start') as HTMLButtonElement;
  btn.disabled = folders.length === 0;
  btn.textContent = folders.length === 0
    ? 'Select folders to scan'
    : `Start Scan (${folders.length} folder${folders.length > 1 ? 's' : ''})`;
}

async function startScan() {
  const mode = (document.getElementById('sel-mode') as HTMLSelectElement).value as ScanOptions['mode'];
  const videoStrategy = (document.getElementById('sel-video') as HTMLSelectElement).value as ScanOptions['video_strategy'];
  const threshold = parseInt((document.getElementById('slider-threshold') as HTMLInputElement).value);

  await api.setFolderPriorities(priorities);

  const options: ScanOptions = {
    folders,
    mode,
    video_strategy: videoStrategy,
    phash_threshold: threshold,
    folder_priorities: priorities,
    multi_frame_count: 8,
  };

  setLastPhashThreshold(threshold);
  navigate('progress');
  api.scan(options).catch(e => {
    showToast(String(e));
    navigate('scan-config');
  });
}

async function clearCache() {
  await api.clearCache();
  showToast('Cache cleared', 'success');
}
