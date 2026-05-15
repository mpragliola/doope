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
      <button class="ghost" id="btn-regroup" style="font-size:12px;padding:5px 10px">Re-group</button>
      <button class="ghost" id="btn-toggle-priority" style="font-size:12px;padding:5px 10px;margin-left:auto">Priority ▾</button>
    </div>
    <div id="priority-panel" style="display:none;padding:8px 16px;background:#131313;border-bottom:1px solid #2a2a2a;flex-shrink:0">
      <div style="font-size:11px;color:#666;margin-bottom:6px">Drag to reorder — affects Auto-mark</div>
      <ul id="results-priority-list" style="list-style:none;display:flex;flex-direction:column;gap:4px"></ul>
    </div>
    <div style="display:flex;flex:1;overflow:hidden">
      <div style="width:280px;display:flex;flex-direction:column;border-right:1px solid #2a2a2a">
        <div style="padding:10px 12px;font-size:11px;color:#666;border-bottom:1px solid #1e1e1e">DUPLICATE GROUPS</div>
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
      <button class="danger" id="btn-delete" disabled>Delete Marked</button>
    </div>
  `;

  el.querySelector('#btn-back')!.addEventListener('click', () => {
    groups = []; marked.clear(); selectedGroupId = null;
    navigate('scan-config');
  });
  el.querySelector('#btn-delete')!.addEventListener('click', confirmDelete);
  wireControlsBar();

  window.addEventListener('scan-complete', loadResults);
}

function reapplyGroupSelection() {
  document.querySelectorAll('#group-list li[data-id]').forEach(li => {
    (li as HTMLElement).style.removeProperty('background');
  });
  if (selectedGroupId) {
    const li = document.querySelector(`#group-list li[data-id="${selectedGroupId}"]`) as HTMLElement | null;
    if (li) li.style.background = '#1e2a3a';
  }
}

function wireControlsBar() {
  const slider = document.getElementById('results-threshold') as HTMLInputElement;
  const lbl = document.getElementById('results-threshold-lbl')!;
  slider.addEventListener('input', () => {
    currentThreshold = parseInt(slider.value);
    lbl.textContent = slider.value;
  });

  document.getElementById('btn-regroup')!.addEventListener('click', async () => {
    try {
      await api.regroup(currentThreshold);
      const prevSelected = selectedGroupId;
      groups = await api.getDuplicateGroups();
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
    }
  });

  const toggleBtn = document.getElementById('btn-toggle-priority')!;
  const panel = document.getElementById('priority-panel')!;
  toggleBtn.addEventListener('click', () => {
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    toggleBtn.textContent = open ? 'Priority ▾' : 'Priority ▴';
  });
}

export async function loadResults() {
  groups = await api.getDuplicateGroups();
  marked.clear();
  selectedGroupId = null;

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
  ul.innerHTML = resultsPriorities.map((f, i) => `
    <li draggable="true" data-idx="${i}"
        style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:#222;border-radius:4px;font-size:11px;cursor:grab">
      <span style="color:#666;margin-right:4px">${i + 1}.</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis" title="${f}">${f}</span>
    </li>
  `).join('');

  let dragSrc = -1;
  ul.querySelectorAll('li').forEach(li => {
    li.addEventListener('dragstart', () => { dragSrc = parseInt((li as HTMLElement).dataset.idx!); });
    li.addEventListener('dragover', e => { e.preventDefault(); });
    li.addEventListener('drop', () => {
      const dest = parseInt((li as HTMLElement).dataset.idx!);
      if (dragSrc !== dest) {
        const [item] = resultsPriorities.splice(dragSrc, 1);
        resultsPriorities.splice(dest, 0, item);
        api.setFolderPriorities(resultsPriorities).catch(() => {});
        renderResultsPriorityList();
      }
    });
  });
}

function renderGroupList() {
  const ul = document.getElementById('group-list')!;
  const summary = document.getElementById('lbl-summary')!;

  summary.textContent = groups.length === 0
    ? 'No duplicates found'
    : `${groups.length} group${groups.length !== 1 ? 's' : ''} found`;

  ul.innerHTML = groups.map(g => {
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
    const borderStyle = noSurvivors ? 'border-left:3px solid #ef4444' : 'border-left:3px solid transparent';
    const distLabel = g.duplicate_type === 'perceptual' && g.max_distance !== undefined
      ? `<span style="font-size:10px;color:#555;margin-left:4px">d=${g.max_distance}</span>`
      : '';

    const survivorLine = markedCount > 0
      ? `<div style="font-size:10px;color:${noSurvivors ? '#ef4444' : '#888'};margin-top:2px">
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
        <div style="font-size:11px;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${shortPath(g.files[0]?.path ?? '')}
        </div>
        ${survivorLine}
      </li>
    `;
  }).join('');

  ul.querySelectorAll('li[data-id]').forEach(li => {
    li.addEventListener('click', () => {
      selectedGroupId = (li as HTMLElement).dataset.id!;
      reapplyGroupSelection();
      const group = groups.find(g => g.id === selectedGroupId);
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
      <button class="ghost" data-action="auto-mark" style="font-size:12px;padding:5px 10px">Auto-mark</button>
      <button class="ghost" data-action="keep-all" style="font-size:12px;padding:5px 10px">Keep all</button>
      <button class="ghost" data-action="delete-all" style="font-size:12px;padding:5px 10px;color:#fca5a5">Mark all delete</button>
    </div>
    <div id="file-grid" style="flex:1;display:flex;flex-direction:row;overflow-x:auto;gap:3px;padding:4px;background:#0d0d0d;min-height:0"></div>
  `;

  el.querySelector('[data-action=auto-mark]')!.addEventListener('click', () => autoMark(group));
  el.querySelector('[data-action=keep-all]')!.addEventListener('click', () => {
    group.files.forEach(f => marked.delete(f.path));
    renderComparisonPanel(group);
    renderGroupList();
    updateBottomBar();
  });
  el.querySelector('[data-action=delete-all]')!.addEventListener('click', () => {
    group.files.forEach(f => marked.add(f.path));
    renderComparisonPanel(group);
    renderGroupList();
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
        <div style="height:44px;min-height:44px;display:flex;align-items:center;gap:6px;padding:0 8px;background:${stripBg};flex-shrink:0">
          <div style="flex:1;overflow:hidden;min-width:0">
            <div style="font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                 title="${escapeAttr(f.path)}">${filename(f.path)}</div>
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
      renderGroupList();
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
        renderGroupList();
        updateBottomBar();
      }
    });
  });
}

async function autoMark(group: DuplicateGroup) {
  try {
    const toMark = await api.autoMarkGroup(group.id);
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

  function renderLightboxContent() {
    const fi = imageFiles[currentIdx];
    overlay.innerHTML = `
      <div style="position:absolute;top:12px;right:12px;display:flex;gap:8px">
        <span style="font-size:12px;color:#888;align-self:center">${currentIdx + 1} / ${imageFiles.length}</span>
        <button id="lb-close" class="ghost" style="padding:5px 12px;font-size:13px">✕ Close</button>
      </div>
      <div style="position:absolute;bottom:16px;font-size:12px;color:#888;max-width:80%;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
           title="${escapeAttr(fi.path)}">${fi.path}</div>
      <button id="lb-prev" class="ghost"
              style="position:absolute;left:12px;top:50%;transform:translateY(-50%);padding:10px 14px;font-size:18px${currentIdx === 0 ? ';opacity:0.2;cursor:default' : ''}">‹</button>
      <img src="${convertFileSrc(fi.path)}"
           style="max-width:calc(100vw - 120px);max-height:calc(100vh - 80px);object-fit:contain;border-radius:4px">
      <button id="lb-next" class="ghost"
              style="position:absolute;right:12px;top:50%;transform:translateY(-50%);padding:10px 14px;font-size:18px${currentIdx === imageFiles.length - 1 ? ';opacity:0.2;cursor:default' : ''}">›</button>
    `;

    overlay.querySelector('#lb-close')!.addEventListener('click', () => overlay.remove());
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
    if (e.target === overlay) overlay.remove();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
    if (e.key === 'ArrowLeft' && currentIdx > 0) { currentIdx--; renderLightboxContent(); }
    if (e.key === 'ArrowRight' && currentIdx < imageFiles.length - 1) { currentIdx++; renderLightboxContent(); }
  };
  document.addEventListener('keydown', onKey);
}
function showLastCopyWarning(_cell: HTMLElement, _path: string, _group: DuplicateGroup) { /* implemented in Task 11 */ }

function updateBottomBar() {
  const deleteBtn = document.getElementById('btn-delete') as HTMLButtonElement;
  const spaceLabel = document.getElementById('lbl-space')!;

  const anyUnsafe = groups.some(g => g.files.every(f => marked.has(f.path)));
  deleteBtn.disabled = marked.size === 0 || anyUnsafe;

  const totalBytes = [...marked].reduce((sum, path) => {
    const file = groups.flatMap(g => g.files).find((f: FileInfo) => f.path === path);
    return sum + (file?.size ?? 0);
  }, 0);

  if (marked.size === 0) {
    spaceLabel.textContent = 'No files marked for deletion';
  } else if (anyUnsafe) {
    spaceLabel.textContent = '⚠ One group has no survivors — adjust marking';
  } else {
    spaceLabel.textContent = `${marked.size} file${marked.size !== 1 ? 's' : ''} marked — ${(totalBytes / 1_048_576).toFixed(1)} MB to free`;
  }
}

async function confirmDelete() {
  const count = marked.size;
  const confirmed = window.confirm(`Delete ${count} file${count !== 1 ? 's' : ''}? This cannot be undone.`);
  if (!confirmed) return;

  try {
    await api.deleteMarked([...marked]);
    marked.clear();
    showToast(`Deleted ${count} file${count !== 1 ? 's' : ''}`, 'success');
    groups = await api.getDuplicateGroups();
    selectedGroupId = null;
    renderGroupList();
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
