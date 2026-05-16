import { convertFileSrc } from '@tauri-apps/api/core';
import { api } from '../api';
import { navigate, showToast } from '../main';
import { lastPhashThreshold } from '../scan-state';
import type { DuplicateGroup, FileInfo } from '../types';

let groups: DuplicateGroup[] = [];
let marked = new Set<string>();
let selectedGroupId: string | null = null;
let currentThreshold = 8;
let resultsPriorities: string[] = [];
let resultsKeyHandler: ((e: KeyboardEvent) => void) | null = null;
type SortMode = 'default' | 'files-desc' | 'files-asc' | 'size-desc' | 'size-asc';
let sortMode: SortMode = 'default';
let autoMarkMode: 'priority' | 'quality' = 'priority';
let fileIndex = new Map<string, FileInfo>();
let selectedLi: HTMLElement | null = null;

export function renderResults(el: HTMLElement) {
  el.innerHTML = `
    <div class="toolbar">
      <h1>Results</h1>
      <button class="ghost" id="btn-back">← New Scan</button>
      <span id="lbl-summary" style="font-size:13px;color:#aaa"></span>
    </div>
    <div id="controls-bar" style="display:flex;align-items:center;gap:10px;padding:8px 16px;background:#161616;border-bottom:1px solid #2a2a2a;flex-shrink:0">
      <span style="font-size:12px;color:#888">Threshold:</span>
      <input type="range" id="results-threshold" min="0" max="20" value="8" style="width:110px;padding:0">
      <span id="results-threshold-lbl" style="font-size:12px;min-width:18px;color:#e2e2e2">8</span>
      <button class="ghost" id="btn-regroup" style="font-size:12px;padding:5px 10px">Re-group <kbd style="font-size:10px;opacity:0.6">R</kbd></button>
      <span id="regroup-status" style="font-size:12px;color:#666;display:none"></span>
      <button class="ghost" id="btn-toggle-priority" style="font-size:12px;padding:5px 10px;margin-left:auto">Priority ▾</button>
    </div>
    <div id="priority-panel" style="display:none;padding:8px 16px;background:#131313;border-bottom:1px solid #2a2a2a;flex-shrink:0">
      <div style="font-size:11px;color:#666;margin-bottom:6px">Drag to reorder — affects Auto-mark</div>
      <ul id="results-priority-list" style="list-style:none;display:flex;flex-direction:column;gap:4px"></ul>
    </div>
    <div style="display:flex;flex:1;overflow:hidden">
      <div style="width:280px;display:flex;flex-direction:column;border-right:1px solid #2a2a2a">
        <div style="padding:6px 12px;font-size:11px;color:#666;border-bottom:1px solid #1e1e1e;display:flex;align-items:center">
          <span style="flex:1">DUPLICATE GROUPS</span>
          <div style="position:relative">
            <button class="ghost" id="btn-sort" style="font-size:11px;padding:3px 8px">Sort ▾</button>
            <div id="sort-dropdown" style="display:none;position:absolute;right:0;top:100%;z-index:100;background:#1e1e1e;border:1px solid #333;border-radius:4px;min-width:110px;padding:4px 0"></div>
          </div>
        </div>
        <ul id="group-list" class="scroll-list" style="list-style:none"></ul>
      </div>
      <div id="group-detail" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
        <div style="flex:1;display:flex;align-items:center;justify-content:center;color:#555;font-size:14px">
          Select a group to inspect
        </div>
      </div>
    </div>
    <div style="padding:12px 16px;background:#1a1a1a;border-top:1px solid #2a2a2a;display:flex;align-items:center;gap:12px;flex-shrink:0">
      <span id="lbl-space" style="flex:1;font-size:13px;color:#aaa"></span>
      <button class="danger" id="btn-delete" disabled>Delete Marked <kbd style="font-size:10px;opacity:0.7">Del</kbd></button>
    </div>
  `;

  el.querySelector('#btn-back')!.addEventListener('click', () => {
    groups = []; marked.clear(); selectedGroupId = null; sortMode = 'default';
    unregisterResultsKeys();
    navigate('scan-config');
  });
  el.querySelector('#btn-delete')!.addEventListener('click', confirmDelete);
  wireControlsBar();
  registerResultsKeys();

  window.addEventListener('scan-complete', loadResults);
}

function reapplyGroupSelection() {
  if (selectedLi) selectedLi.style.removeProperty('background');
  selectedLi = null;
  if (selectedGroupId) {
    const li = document.querySelector(`#group-list li[data-id="${selectedGroupId}"]`) as HTMLElement | null;
    if (li) { li.style.background = '#1e2a3a'; selectedLi = li; }
  }
}

function buildFileIndex() {
  fileIndex.clear();
  for (const g of groups) {
    for (const f of g.files) fileIndex.set(f.path, f);
  }
}

function updateGroupListItem(group: DuplicateGroup) {
  const li = document.querySelector(`#group-list li[data-id="${group.id}"]`) as HTMLElement | null;
  if (!li) return;
  const survivors = group.files.filter(f => !marked.has(f.path)).length;
  const markedCount = group.files.length - survivors;
  const noSurvivors = survivors === 0 && markedCount > 0;
  const borderColor = noSurvivors ? '#ef4444' : markedCount > 0 ? '#f59e0b' : 'transparent';
  li.style.borderLeftColor = borderColor;
  li.querySelectorAll<HTMLElement>('.group-path-span').forEach((span, i) => {
    const f = group.files[i];
    if (!f) return;
    span.style.color = markedCount > 0 ? (marked.has(f.path) ? '#f87171' : '#4ade80') : '#555';
  });
  const existing = li.querySelector<HTMLElement>('.survivor-line');
  if (markedCount > 0) {
    const text = `${markedCount} marked → ${survivors} survive${noSurvivors ? ' ⚠' : ''}`;
    const color = noSurvivors ? '#ef4444' : '#888';
    if (existing) { existing.style.color = color; existing.textContent = text; }
    else {
      const div = document.createElement('div');
      div.className = 'survivor-line';
      div.style.cssText = `font-size:10px;color:${color};margin-top:2px`;
      div.textContent = text;
      li.appendChild(div);
    }
  } else { existing?.remove(); }
}

function wireControlsBar() {
  const slider = document.getElementById('results-threshold') as HTMLInputElement;
  const lbl = document.getElementById('results-threshold-lbl')!;
  slider.addEventListener('input', () => {
    currentThreshold = parseInt(slider.value);
    lbl.textContent = slider.value;
  });

  const regroupBtn = document.getElementById('btn-regroup') as HTMLButtonElement;
  regroupBtn.addEventListener('click', async () => {
    if (regroupBtn.disabled) return;

    const status = document.getElementById('regroup-status') as HTMLElement;
    const originalLabel = regroupBtn.innerHTML;
    regroupBtn.disabled = true;
    regroupBtn.textContent = 'Re-grouping…';
    status.style.display = 'inline';

    const phaseLabels: Record<string, string> = {
      filename: 'filename…',
      exact: 'exact hash…',
      perceptual: 'perceptual…',
    };

    let unlisten: (() => void) | null = null;
    try {
      unlisten = await api.onRegroupProgress((phase) => {
        status.textContent = phaseLabels[phase] ?? phase;
      });
      await api.regroup(currentThreshold);
      const prevSelected = selectedGroupId;
      groups = await api.getDuplicateGroups();
      buildFileIndex();
      marked.clear();
      selectedGroupId = null;
      renderGroupList();
      updateBottomBar();
      if (prevSelected) {
        const g = groups.find(g => g.id === prevSelected);
        if (g) {
          selectedGroupId = g.id;
          reapplyGroupSelection();
          renderGroupDetail(g);
        }
      }
    } catch (e) {
      showToast(String(e));
    } finally {
      unlisten?.();
      regroupBtn.disabled = false;
      regroupBtn.innerHTML = originalLabel;
      status.style.display = 'none';
      status.textContent = '';
    }
  });

  const toggleBtn = document.getElementById('btn-toggle-priority')!;
  const panel = document.getElementById('priority-panel')!;
  toggleBtn.addEventListener('click', () => {
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    toggleBtn.textContent = open ? 'Priority ▾' : 'Priority ▴';
  });

  wireSortDropdown();
}

function wireSortDropdown() {
  const btn = document.getElementById('btn-sort');
  const dropdown = document.getElementById('sort-dropdown');
  if (!btn || !dropdown) return;

  const options: { label: string; value: SortMode }[] = [
    { label: 'Default', value: 'default' },
    { label: 'Files ↓', value: 'files-desc' },
    { label: 'Files ↑', value: 'files-asc' },
    { label: 'Size ↓', value: 'size-desc' },
    { label: 'Size ↑', value: 'size-asc' },
  ];

  function renderDropdown() {
    dropdown!.innerHTML = options.map(o => `
      <div data-sort="${o.value}" style="padding:5px 12px;cursor:pointer;font-size:11px;color:${sortMode === o.value ? '#e2e2e2' : '#888'};background:${sortMode === o.value ? '#2a2a2a' : 'transparent'}">
        ${sortMode === o.value ? '✓ ' : ''}${o.label}
      </div>
    `).join('');
    dropdown!.querySelectorAll('[data-sort]').forEach(el => {
      el.addEventListener('click', () => {
        sortMode = (el as HTMLElement).dataset.sort as SortMode;
        dropdown!.style.display = 'none';
        btn!.textContent = sortMode === 'default' ? 'Sort ▾' : `Sort: ${options.find(o => o.value === sortMode)!.label} ▾`;
        renderGroupList();
      });
    });
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dropdown.style.display !== 'none';
    dropdown.style.display = open ? 'none' : 'block';
    if (!open) renderDropdown();
  });

  document.addEventListener('click', () => { dropdown.style.display = 'none'; });
}

export async function loadResults() {
  groups = await api.getDuplicateGroups();
  marked.clear();
  selectedGroupId = null;
  selectedLi = null;
  buildFileIndex();

  // Sync threshold slider to last scan's setting
  currentThreshold = lastPhashThreshold;
  const slider = document.getElementById('results-threshold') as HTMLInputElement;
  const lbl = document.getElementById('results-threshold-lbl')!;
  if (slider) {
    slider.value = String(currentThreshold);
    lbl.textContent = String(currentThreshold);
  }

  // Load folder priorities
  try {
    resultsPriorities = await api.getFolderPriorities();
  } catch {
    resultsPriorities = [];
  }
  renderResultsPriorityList();

  renderGroupList();
  updateBottomBar();
}

function renderResultsPriorityList() {
  const ul = document.getElementById('results-priority-list');
  if (!ul) return;
  const grip = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" style="display:block">
    <circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/>
    <circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/>
    <circle cx="3" cy="11" r="1.2"/><circle cx="7" cy="11" r="1.2"/>
  </svg>`;

  ul.innerHTML = resultsPriorities.map((f, i) => `
    <li data-idx="${i}"
        style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:#222;border-radius:4px;font-size:11px;user-select:none">
      <span class="drag-handle" style="cursor:grab;display:flex;align-items:center;color:#555;flex-shrink:0;touch-action:none">${grip}</span>
      <span style="color:#666;margin-right:4px">${i + 1}.</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis" title="${f}">${f}</span>
    </li>
  `).join('');

  let srcIdx = -1;
  ul.querySelectorAll<HTMLElement>('.drag-handle').forEach(handle => {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const li = handle.closest('li') as HTMLElement;
      srcIdx = parseInt(li.dataset.idx!);
      handle.setPointerCapture(e.pointerId);
      li.style.opacity = '0.5';
    });

    handle.addEventListener('pointerup', (e) => {
      if (srcIdx === -1) return;
      const saved = srcIdx;
      srcIdx = -1;
      ul.querySelectorAll<HTMLElement>('li').forEach(l => { l.style.opacity = ''; });
      const overEl = document.elementFromPoint(e.clientX, e.clientY);
      const overLi = overEl?.closest('li[data-idx]') as HTMLElement | null;
      const destIdx = overLi ? parseInt(overLi.dataset.idx!) : saved;
      if (destIdx !== saved) {
        const [item] = resultsPriorities.splice(saved, 1);
        resultsPriorities.splice(destIdx, 0, item);
        api.setFolderPriorities(resultsPriorities).catch(() => {});
        renderResultsPriorityList();
      }
    });
  });
}

function sortedGroups(): DuplicateGroup[] {
  const copy = [...groups];
  if (sortMode === 'files-desc') copy.sort((a, b) => b.files.length - a.files.length);
  else if (sortMode === 'files-asc') copy.sort((a, b) => a.files.length - b.files.length);
  else if (sortMode === 'size-desc') copy.sort((a, b) => b.wasted_bytes - a.wasted_bytes);
  else if (sortMode === 'size-asc') copy.sort((a, b) => a.wasted_bytes - b.wasted_bytes);
  return copy;
}

function renderGroupList() {
  selectedLi = null;
  const ul = document.getElementById('group-list')!;
  const summary = document.getElementById('lbl-summary')!;

  summary.textContent = groups.length === 0
    ? 'No duplicates found'
    : `${groups.length} group${groups.length !== 1 ? 's' : ''} found`;

  ul.innerHTML = sortedGroups().map(g => {
    const wastedMb = (g.wasted_bytes / 1_048_576).toFixed(1);

    // Extended badge: ≈ = perceptual-identical (dist 0), ~ = perceptual-similar, = exact, F filename
    let badge: string;
    let badgeColor: string;
    if (g.duplicate_type === 'exact') {
      badge = '='; badgeColor = '#3b82f6';
    } else if (g.duplicate_type === 'perceptual') {
      if (g.max_distance === 0) {
        badge = '≈'; badgeColor = '#22c55e';
      } else {
        badge = '~'; badgeColor = '#a855f7';
      }
    } else {
      badge = 'F'; badgeColor = '#f59e0b';
    }

    const survivors = g.files.filter(f => !marked.has(f.path)).length;
    const markedCount = g.files.length - survivors;
    const noSurvivors = survivors === 0;
    const borderColor = noSurvivors && markedCount > 0
      ? '#ef4444'
      : markedCount > 0
        ? '#f59e0b'
        : 'transparent';
    const borderStyle = `border-left:3px solid ${borderColor}`;
    const distLabel = g.duplicate_type === 'perceptual' && g.max_distance !== undefined
      ? (() => {
          const similarity = Math.round((64 - g.max_distance) / 64 * 100);
          const color = similarity === 100 ? '#22c55e' : similarity >= 90 ? '#a855f7' : '#f59e0b';
          return `<span style="font-size:10px;color:${color};font-weight:600;margin-left:4px">${similarity}% similar</span>`;
        })()
      : '';

    const survivorLine = markedCount > 0
      ? `<div class="survivor-line" style="font-size:10px;color:${noSurvivors ? '#ef4444' : '#888'};margin-top:2px">
           ${markedCount} marked → ${survivors} survive${noSurvivors ? ' ⚠' : ''}
         </div>`
      : '';

    return `
      <li data-id="${g.id}" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid #1e1e1e;display:flex;flex-direction:column;gap:2px;${borderStyle}">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="background:${badgeColor};color:#fff;font-size:10px;border-radius:3px;padding:1px 5px">${badge}</span>
          ${distLabel}
          <span style="font-size:13px;font-weight:500">${g.files.length} files</span>
          <span style="font-size:11px;color:#666;margin-left:auto">${wastedMb} MB</span>
        </div>
        <div style="font-size:10px;display:flex;flex-direction:column;gap:1px;margin-top:2px">
          ${g.files.map(f => {
            const isMarked = marked.has(f.path);
            const pathColor = markedCount > 0 ? (isMarked ? '#f87171' : '#4ade80') : '#555';
            return `<span class="group-path-span" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${pathColor}" title="${escapeAttr(f.path)}">${escapeAttr(shortPath(f.path))}</span>`;
          }).join('')}
        </div>
        ${survivorLine}
      </li>
    `;
  }).join('');

  ul.querySelectorAll('li[data-id]').forEach(li => {
    const id = (li as HTMLElement).dataset.id!;
    li.addEventListener('click', () => {
      selectedGroupId = id;
      if (selectedLi) selectedLi.style.removeProperty('background');
      (li as HTMLElement).style.background = '#1e2a3a';
      selectedLi = li as HTMLElement;
      const group = groups.find(g => g.id === id);
      if (group) renderGroupDetail(group);
    });
  });

  reapplyGroupSelection();
}

function renderGroupDetail(group: DuplicateGroup) {
  const el = document.getElementById('group-detail')!;

  let headerLabel = '';
  if (group.duplicate_type === 'perceptual') {
    headerLabel = group.max_distance === 0
      ? 'Perceptual identical (distance: 0)'
      : `Perceptual similar (distance: ${group.max_distance ?? '?'})`;
  } else if (group.duplicate_type === 'exact') {
    headerLabel = 'Exact duplicates';
  } else {
    headerLabel = 'Filename match';
  }

  el.innerHTML = `
    <div style="padding:10px 14px;border-bottom:1px solid #1e1e1e;display:flex;gap:8px;align-items:center;flex-shrink:0">
      <div style="flex:1;overflow:hidden">
        <span style="font-size:13px;font-weight:500">${group.files.length} files</span>
        <span style="font-size:11px;color:#666;margin-left:8px">${headerLabel}</span>
      </div>
      <div style="display:flex;gap:1px">
        <button class="ghost" data-action="auto-mark" style="font-size:12px;padding:5px 10px">
          Auto-mark <kbd style="font-size:10px;opacity:0.6">A</kbd>
        </button>
      </div>
      <button class="ghost" data-action="keep-all" style="font-size:12px;padding:5px 10px">Keep all <kbd style="font-size:10px;opacity:0.6">K</kbd></button>
      <button class="ghost" data-action="delete-all" style="font-size:12px;padding:5px 10px;color:#fca5a5">Mark all <kbd style="font-size:10px;opacity:0.7">M</kbd></button>
    </div>
    <div id="file-grid" style="flex:1;display:flex;flex-direction:row;overflow-x:auto;gap:3px;padding:4px;background:#0d0d0d;min-height:0"></div>
  `;

  el.querySelector('[data-action=auto-mark]')!.addEventListener('click', () => autoMark(group));

  el.querySelector('[data-action=keep-all]')!.addEventListener('click', () => {
    group.files.forEach(f => marked.delete(f.path));
    renderComparisonPanel(group);
    updateGroupListItem(group);
    updateBottomBar();
  });
  el.querySelector('[data-action=delete-all]')!.addEventListener('click', () => {
    group.files.forEach(f => marked.add(f.path));
    renderComparisonPanel(group);
    updateGroupListItem(group);
    updateBottomBar();
  });

  renderComparisonPanel(group);
}

function renderComparisonPanel(group: DuplicateGroup) {
  const grid = document.getElementById('file-grid')!;

  grid.innerHTML = group.files.map(f => {
    const isMarked = marked.has(f.path);
    const isImage = f.media_type === 'image';
    const sizeMb = (f.size / 1_048_576).toFixed(2);
    const borderColor = isMarked ? '#7f1d1d' : '#1a3a28';
    const stripBg = isMarked ? '#2d1515' : '#0f1f18';

    const imageArea = isImage
      ? `<div style="flex:1;position:relative;min-height:0;overflow:hidden;background:#080808">
           <img
             src="${convertFileSrc(f.path)}"
             data-action="lightbox"
             style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;cursor:zoom-in"
             onerror="this.style.opacity='0.2'"
           >
         </div>`
      : `<div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#444;font-size:12px">VIDEO</div>`;

    return `
      <div data-path="${escapeAttr(f.path)}"
           style="flex:1;min-width:180px;display:flex;flex-direction:column;border:2px solid ${borderColor};border-radius:6px;overflow:hidden">
        ${imageArea}
        <div style="min-height:56px;display:flex;align-items:center;gap:6px;padding:4px 8px;background:${stripBg};flex-shrink:0">
          <div style="flex:1;overflow:hidden;min-width:0">
            <div style="font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                 title="${escapeAttr(f.path)}">${filename(f.path)}</div>
            <div style="font-size:10px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                 title="${escapeAttr(f.path)}">${escapeAttr(f.path)}</div>
            <div style="font-size:10px;color:#888">${sizeMb} MB</div>
          </div>
          <button class="${isMarked ? 'ghost' : 'primary'}" data-action="keep"
                  style="font-size:10px;padding:3px 8px;flex-shrink:0">Keep</button>
          <button class="${isMarked ? 'danger' : 'ghost'}" data-action="delete"
                  style="font-size:10px;padding:3px 8px;flex-shrink:0">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('[data-path]').forEach(cell => {
    const path = (cell as HTMLElement).dataset.path!;
    const file = group.files.find(f => f.path === path)!;

    cell.querySelector('[data-action=lightbox]')?.addEventListener('click', () => {
      openLightbox(file, group);
    });

    cell.querySelector('[data-action=keep]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      marked.delete(path);
      renderComparisonPanel(group);
      updateGroupListItem(group);
      updateBottomBar();
    });

    cell.querySelector('[data-action=delete]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      const survivors = group.files.filter(f => f.path !== path && !marked.has(f.path)).length;
      if (survivors === 0) {
        showLastCopyWarning(cell as HTMLElement, path, group);
      } else {
        marked.add(path);
        renderComparisonPanel(group);
        updateGroupListItem(group);
        updateBottomBar();
      }
    });
  });
}

async function autoMark(group: DuplicateGroup) {
  try {
    const toMark = await api.autoMarkGroup(group.id, autoMarkMode);
    toMark.forEach(p => marked.add(p));
    renderComparisonPanel(group);
    renderGroupList();
    updateBottomBar();
  } catch (e) {
    showToast(String(e));
  }
}

function openLightbox(f: FileInfo, group: DuplicateGroup) {
  const imageFiles = group.files.filter(fi => fi.media_type === 'image');
  let currentIdx = imageFiles.findIndex(fi => fi.path === f.path);

  const overlay = document.createElement('div');
  overlay.id = 'lightbox-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.92)',
    'display:flex;flex-direction:column;align-items:center;justify-content:center',
  ].join(';');

  // Declare onKey before closeLightbox so closeLightbox can reference it
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft' && currentIdx > 0) { currentIdx--; renderLightboxContent(); }
    if (e.key === 'ArrowRight' && currentIdx < imageFiles.length - 1) { currentIdx++; renderLightboxContent(); }
  };

  const closeLightbox = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };

  function renderLightboxContent() {
    const fi = imageFiles[currentIdx];
    overlay.innerHTML = `
      <div style="position:absolute;top:12px;right:12px;display:flex;gap:8px">
        <span style="font-size:12px;color:#888;align-self:center">${currentIdx + 1} / ${imageFiles.length}</span>
        <button id="lb-close" class="ghost" style="padding:5px 12px;font-size:13px">✕ Close</button>
      </div>
      <div style="position:absolute;bottom:16px;font-size:12px;color:#888;max-width:80%;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
           title="${escapeAttr(fi.path)}">${escapeAttr(fi.path)}</div>
      <button id="lb-prev" class="ghost"
              style="position:absolute;left:12px;top:50%;transform:translateY(-50%);padding:10px 14px;font-size:18px${currentIdx === 0 ? ';opacity:0.2;cursor:default' : ''}">‹</button>
      <img src="${convertFileSrc(fi.path)}"
           style="max-width:calc(100vw - 120px);max-height:calc(100vh - 80px);object-fit:contain;border-radius:4px">
      <button id="lb-next" class="ghost"
              style="position:absolute;right:12px;top:50%;transform:translateY(-50%);padding:10px 14px;font-size:18px${currentIdx === imageFiles.length - 1 ? ';opacity:0.2;cursor:default' : ''}">›</button>
    `;

    overlay.querySelector('#lb-close')!.addEventListener('click', closeLightbox);
    overlay.querySelector('#lb-prev')!.addEventListener('click', () => {
      if (currentIdx > 0) { currentIdx--; renderLightboxContent(); }
    });
    overlay.querySelector('#lb-next')!.addEventListener('click', () => {
      if (currentIdx < imageFiles.length - 1) { currentIdx++; renderLightboxContent(); }
    });
  }

  renderLightboxContent();
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeLightbox();
  });

  document.addEventListener('keydown', onKey);
}
function showLastCopyWarning(cell: HTMLElement, path: string, group: DuplicateGroup) {
  // Remove any existing warning in this group's panel
  document.querySelectorAll('.last-copy-warning').forEach(w => w.remove());

  const warning = document.createElement('div');
  warning.className = 'last-copy-warning';
  warning.style.cssText = [
    'position:absolute;bottom:56px;left:0;right:0',
    'background:#7f1d1d;color:#fca5a5;font-size:11px',
    'padding:6px 10px;display:flex;align-items:center;gap:8px;z-index:10',
  ].join(';');
  warning.innerHTML = `
    <span style="flex:1">Last copy — mark anyway?</span>
    <button class="danger" data-action="confirm-delete" style="font-size:10px;padding:3px 8px">Confirm</button>
    <button class="ghost" data-action="cancel-delete" style="font-size:10px;padding:3px 8px">Cancel</button>
  `;

  // The cell needs position:relative for the warning overlay to work
  cell.style.position = 'relative';
  cell.appendChild(warning);

  warning.querySelector('[data-action=confirm-delete]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    warning.remove();
    marked.add(path);
    renderComparisonPanel(group);
    updateGroupListItem(group);
    updateBottomBar();
  });

  warning.querySelector('[data-action=cancel-delete]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    warning.remove();
  });
}

function registerResultsKeys() {
  unregisterResultsKeys();
  resultsKeyHandler = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
    if (document.getElementById('lightbox-overlay')) return;

    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      (document.getElementById('btn-regroup') as HTMLButtonElement | null)?.click();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      const btn = document.getElementById('btn-delete') as HTMLButtonElement | null;
      if (btn && !btn.disabled) btn.click();
    } else if (selectedGroupId) {
      const group = groups.find(g => g.id === selectedGroupId);
      if (!group) return;
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        autoMark(group);
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        group.files.forEach(f => marked.delete(f.path));
        renderComparisonPanel(group);
        updateGroupListItem(group);
        updateBottomBar();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        group.files.forEach(f => marked.add(f.path));
        renderComparisonPanel(group);
        updateGroupListItem(group);
        updateBottomBar();
      } else {
        const n = parseInt(e.key);
        if (!isNaN(n) && n >= 1 && n <= group.files.length) {
          e.preventDefault();
          group.files.forEach((f, i) => {
            if (i === n - 1) marked.delete(f.path);
            else marked.add(f.path);
          });
          renderComparisonPanel(group);
          updateGroupListItem(group);
          updateBottomBar();
        }
      }
    }
  };
  window.addEventListener('keydown', resultsKeyHandler);
}

function unregisterResultsKeys() {
  if (resultsKeyHandler) {
    window.removeEventListener('keydown', resultsKeyHandler);
    resultsKeyHandler = null;
  }
}

function updateBottomBar() {
  const deleteBtn = document.getElementById('btn-delete') as HTMLButtonElement;
  const spaceLabel = document.getElementById('lbl-space')!;

  const anyUnsafe = groups.some(g => g.files.every(f => marked.has(f.path)));
  deleteBtn.disabled = marked.size === 0;

  const totalBytes = [...marked].reduce((sum, path) => sum + (fileIndex.get(path)?.size ?? 0), 0);

  if (marked.size === 0) {
    spaceLabel.textContent = 'No files marked for deletion';
  } else if (anyUnsafe) {
    spaceLabel.textContent = `⚠ ${marked.size} file${marked.size !== 1 ? 's' : ''} marked — some groups fully deleted (${(totalBytes / 1_048_576).toFixed(1)} MB)`;
  } else {
    spaceLabel.textContent = `${marked.size} file${marked.size !== 1 ? 's' : ''} marked — ${(totalBytes / 1_048_576).toFixed(1)} MB to free`;
  }
}

async function confirmDelete() {
  const count = marked.size;
  const anyUnsafe = groups.some(g => g.files.every(f => marked.has(f.path)));
  const msg = anyUnsafe
    ? `Delete ${count} file${count !== 1 ? 's' : ''}? Some groups will have NO survivors — all copies will be lost. This cannot be undone.`
    : `Delete ${count} file${count !== 1 ? 's' : ''}? This cannot be undone.`;
  const confirmed = window.confirm(msg);
  if (!confirmed) return;

  try {
    const prevIndex = groups.findIndex(g => g.id === selectedGroupId);
    await api.deleteMarked([...marked]);
    marked.clear();
    showToast(`Deleted ${count} file${count !== 1 ? 's' : ''}`, 'success');
    groups = await api.getDuplicateGroups();
    buildFileIndex();
    selectedLi = null;
    const nextGroup = groups[prevIndex] ?? groups[prevIndex - 1] ?? null;
    selectedGroupId = nextGroup?.id ?? null;
    renderGroupList();
    if (nextGroup) renderGroupDetail(nextGroup);
    updateBottomBar();
  } catch (e) {
    showToast(String(e));
  }
}

function filename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
