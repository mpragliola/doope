import { convertFileSrc } from '@tauri-apps/api/core';
import { api } from '../api';
import { navigate, showToast } from '../main';
import { lastPhashThreshold, lastFolderPriorities } from '../scan-state';
import type { DuplicateGroup, FileInfo } from '../types';

let groups: DuplicateGroup[] = [];
let marked = new Set<string>();
let selectedGroupId: string | null = null;
let selectedGroupIds = new Set<string>();
let lastClickedSortedIndex = -1;
let currentThreshold = 8;
let resultsKeyHandler: ((e: KeyboardEvent) => void) | null = null;
type SortMode = 'default' | 'files-desc' | 'files-asc' | 'size-desc' | 'size-asc';
let sortMode: SortMode = 'default';
let autoMarkMode: 'priority' | 'quality' = 'priority';
let fileIndex = new Map<string, FileInfo>();
let selectedLi: HTMLElement | null = null;
let filterExt: string | null = null;
let availableExts: string[] = [];
let sidebarWidth = 280;
let currentVisible: DuplicateGroup[] = [];
let scrollAbort: AbortController | null = null;
let groupListItemH = 72;
let kanbanMode = false;
let folderPriorities: string[] = [];
let kanbanGroups: DuplicateGroup[] = [];

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
      <button class="ghost" id="btn-regroup" style="font-size:12px;padding:5px 10px;margin-left:auto">Re-group <kbd style="font-size:10px;opacity:0.6">R</kbd></button>
      <span id="regroup-status" style="font-size:12px;color:#666;display:none"></span>
    </div>
    <div style="display:flex;flex:1;overflow:hidden">
      <div id="sidebar" style="width:${sidebarWidth}px;display:flex;flex-direction:column;border-right:1px solid #2a2a2a;flex-shrink:0">
        <div style="padding:6px 12px;font-size:11px;color:#666;border-bottom:1px solid #1e1e1e;display:flex;align-items:center;gap:4px">
          <span style="flex:1">DUPLICATE GROUPS</span>
          <div style="position:relative">
            <button class="ghost" id="btn-ext-filter" style="font-size:11px;padding:3px 8px">Ext ▾</button>
            <div id="ext-dropdown" style="display:none;position:absolute;right:0;top:100%;z-index:100;background:#1e1e1e;border:1px solid #333;border-radius:4px;min-width:90px;padding:4px 0;max-height:200px;overflow-y:auto"></div>
          </div>
          <div style="position:relative">
            <button class="ghost" id="btn-sort" style="font-size:11px;padding:3px 8px">Sort ▾</button>
            <div id="sort-dropdown" style="display:none;position:absolute;right:0;top:100%;z-index:100;background:#1e1e1e;border:1px solid #333;border-radius:4px;min-width:110px;padding:4px 0"></div>
          </div>
        </div>
        <ul id="group-list" class="scroll-list" style="list-style:none;user-select:none"></ul>
      </div>
      <div id="resize-handle" style="width:5px;cursor:col-resize;flex-shrink:0;background:transparent;transition:background 0.12s"></div>
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
    groups = []; marked.clear(); selectedGroupId = null; selectedGroupIds.clear();
    lastClickedSortedIndex = -1; sortMode = 'default'; filterExt = null;
    unregisterResultsKeys();
    navigate('scan-config');
  });
  el.querySelector('#btn-delete')!.addEventListener('click', confirmDelete);
  wireControlsBar();
  el.querySelector<HTMLElement>('#group-list')!.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-id]');
    if (!li) return;
    const me = e as MouseEvent;
    const clickedId = li.dataset.id!;
    const clickedIdx = currentVisible.findIndex(g => g.id === clickedId);
    if (me.shiftKey && lastClickedSortedIndex !== -1) {
      const lo = Math.min(lastClickedSortedIndex, clickedIdx);
      const hi = Math.max(lastClickedSortedIndex, clickedIdx);
      for (let i = lo; i <= hi; i++) selectedGroupIds.add(currentVisible[i].id);
    } else if (me.ctrlKey || me.metaKey) {
      if (selectedGroupIds.has(clickedId)) {
        selectedGroupIds.delete(clickedId);
        if (selectedGroupId === clickedId) {
          const rem = [...selectedGroupIds];
          selectedGroupId = rem.length > 0 ? rem[rem.length - 1] : null;
        }
      } else {
        selectedGroupIds.add(clickedId);
      }
    } else {
      selectedGroupIds.clear();
      selectedGroupIds.add(clickedId);
    }
    if (selectedGroupIds.has(clickedId)) {
      selectedGroupId = clickedId;
      lastClickedSortedIndex = clickedIdx;
    }
    reapplyGroupSelection();
    const group = groups.find(g => g.id === selectedGroupId);
    if (group) renderGroupDetail(group);
  });
  registerResultsKeys();

  window.addEventListener('scan-complete', loadResults);
}

function reapplyGroupSelection() {
  document.querySelectorAll('#group-list li[data-id]').forEach(li => {
    const id = (li as HTMLElement).dataset.id!;
    if (id === selectedGroupId) {
      (li as HTMLElement).style.background = '#1e2a3a';
    } else if (selectedGroupIds.has(id)) {
      (li as HTMLElement).style.background = '#131a25';
    } else {
      (li as HTMLElement).style.removeProperty('background');
    }
  });
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
      buildExtList();
      filterExt = null;
      const extBtn = document.getElementById('btn-ext-filter');
      if (extBtn) extBtn.textContent = 'Ext ▾';
      marked.clear();
      selectedGroupId = null;
      selectedGroupIds.clear();
      lastClickedSortedIndex = -1;
      kanbanMode = false;
      renderGroupList();
      updateBottomBar();
      if (prevSelected) {
        const g = groups.find(g => g.id === prevSelected);
        if (g) {
          selectedGroupId = g.id;
          selectedGroupIds.add(g.id);
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

  wireSortDropdown();
  wireExtFilter();
  wireResizeHandle();
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

function wireExtFilter() {
  const btn = document.getElementById('btn-ext-filter');
  const dropdown = document.getElementById('ext-dropdown');
  if (!btn || !dropdown) return;

  function renderExtDropdown() {
    type ExtOption = { label: string; value: string | null };
    const items: ExtOption[] = [{ label: 'All', value: null }, ...availableExts.map(e => ({ label: e, value: e }))];
    dropdown!.innerHTML = items.map(o => `
      <div data-ext="${o.value ?? ''}" style="padding:5px 12px;cursor:pointer;font-size:11px;color:${filterExt === o.value ? '#e2e2e2' : '#888'};background:${filterExt === o.value ? '#2a2a2a' : 'transparent'}">
        ${filterExt === o.value ? '✓ ' : ''}${o.label}
      </div>
    `).join('');
    dropdown!.querySelectorAll<HTMLElement>('[data-ext]').forEach(el => {
      el.addEventListener('click', () => {
        const val = el.dataset.ext;
        filterExt = val || null;
        dropdown!.style.display = 'none';
        btn!.textContent = filterExt ? `${filterExt} ▾` : 'Ext ▾';
        renderGroupList();
      });
    });
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dropdown.style.display !== 'none';
    dropdown.style.display = open ? 'none' : 'block';
    if (!open) renderExtDropdown();
  });

  document.addEventListener('click', () => { dropdown.style.display = 'none'; });
}

function wireResizeHandle() {
  const handle = document.getElementById('resize-handle');
  const sidebar = document.getElementById('sidebar');
  if (!handle || !sidebar) return;

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mouseenter', () => {
    if (!dragging) handle.style.background = '#3b82f6';
  });
  handle.addEventListener('mouseleave', () => {
    if (!dragging) handle.style.background = 'transparent';
  });
  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    handle.style.background = '#3b82f6';
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const newWidth = Math.min(600, Math.max(160, startWidth + e.clientX - startX));
    sidebarWidth = newWidth;
    sidebar.style.width = `${newWidth}px`;
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.style.background = 'transparent';
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

export async function loadResults() {
  groups = await api.getDuplicateGroups();
  marked.clear();
  selectedGroupId = null;
  selectedGroupIds.clear();
  lastClickedSortedIndex = -1;
  filterExt = null;
  kanbanMode = false;
  folderPriorities = lastFolderPriorities;
  buildFileIndex();
  buildExtList();
  const extBtn = document.getElementById('btn-ext-filter');
  if (extBtn) extBtn.textContent = 'Ext ▾';

  // Sync threshold slider to last scan's setting
  currentThreshold = lastPhashThreshold;
  const slider = document.getElementById('results-threshold') as HTMLInputElement;
  const lbl = document.getElementById('results-threshold-lbl')!;
  if (slider) {
    slider.value = String(currentThreshold);
    lbl.textContent = String(currentThreshold);
  }

  renderGroupList();
  updateBottomBar();
}

function ext(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function buildExtList() {
  const s = new Set<string>();
  for (const g of groups) for (const f of g.files) { const e = ext(f.path); if (e) s.add(e); }
  availableExts = [...s].sort();
}

function filteredSortedGroups(): DuplicateGroup[] {
  let base = groups;
  if (filterExt !== null) base = base.filter(g => g.files.every(f => ext(f.path) === filterExt));
  const copy = [...base];
  if (sortMode === 'files-desc') copy.sort((a, b) => b.files.length - a.files.length);
  else if (sortMode === 'files-asc') copy.sort((a, b) => a.files.length - b.files.length);
  else if (sortMode === 'size-desc') copy.sort((a, b) => b.wasted_bytes - a.wasted_bytes);
  else if (sortMode === 'size-asc') copy.sort((a, b) => a.wasted_bytes - b.wasted_bytes);
  return copy;
}

function groupItemHtml(g: DuplicateGroup): string {
  const wastedMb = (g.wasted_bytes / 1_048_576).toFixed(1);
  let badge: string, badgeColor: string;
  if (g.duplicate_type === 'exact') {
    badge = '='; badgeColor = '#3b82f6';
  } else if (g.duplicate_type === 'perceptual') {
    badge = g.max_distance === 0 ? '≈' : '~';
    badgeColor = g.max_distance === 0 ? '#22c55e' : '#a855f7';
  } else {
    badge = 'F'; badgeColor = '#f59e0b';
  }
  const survivors = g.files.filter(f => !marked.has(f.path)).length;
  const markedCount = g.files.length - survivors;
  const noSurvivors = survivors === 0;
  const borderColor = noSurvivors && markedCount > 0 ? '#ef4444' : markedCount > 0 ? '#f59e0b' : 'transparent';
  const distLabel = g.duplicate_type === 'perceptual' && g.max_distance !== undefined
    ? (() => {
        const sim = Math.round((64 - g.max_distance) / 64 * 100);
        const c = sim === 100 ? '#22c55e' : sim >= 90 ? '#a855f7' : '#f59e0b';
        return `<span style="font-size:10px;color:${c};font-weight:600;margin-left:4px">${sim}% similar</span>`;
      })()
    : '';
  const survivorLine = markedCount > 0
    ? `<div class="survivor-line" style="font-size:10px;color:${noSurvivors ? '#ef4444' : '#888'};margin-top:2px">${markedCount} marked → ${survivors} survive${noSurvivors ? ' ⚠' : ''}</div>`
    : '';
  return `<li data-id="${g.id}" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid #1e1e1e;display:flex;flex-direction:column;gap:2px;border-left:3px solid ${borderColor}">
    <div style="display:flex;align-items:center;gap:6px">
      <span style="background:${badgeColor};color:#fff;font-size:10px;border-radius:3px;padding:1px 5px">${badge}</span>
      ${distLabel}
      <span style="font-size:13px;font-weight:500">${g.files.length} files</span>
      <span style="font-size:11px;color:#666;margin-left:auto">${wastedMb} MB</span>
    </div>
    <div style="font-size:10px;display:flex;flex-direction:column;gap:1px;margin-top:2px">
      ${g.files.map(f => {
        const pathColor = markedCount > 0 ? (marked.has(f.path) ? '#f87171' : '#4ade80') : '#555';
        return `<span class="group-path-span" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${pathColor}" title="${escapeAttr(f.path)}">${escapeAttr(shortPath(f.path))}</span>`;
      }).join('')}
    </div>
    ${survivorLine}
  </li>`;
}

function renderGroupList() {
  selectedLi = null;
  const ul = document.getElementById('group-list')!;
  const summary = document.getElementById('lbl-summary')!;
  const visible = filteredSortedGroups();
  currentVisible = visible;

  if (groups.length === 0) {
    summary.textContent = 'No duplicates found';
  } else if (filterExt) {
    summary.textContent = `${visible.length} of ${groups.length} group${groups.length !== 1 ? 's' : ''}`;
  } else {
    summary.textContent = `${groups.length} group${groups.length !== 1 ? 's' : ''} found`;
  }

  // Virtual scroll: only render the visible slice + overscan.
  // Maintains a padding-top/bottom spacer so the scrollbar reflects the true total height.
  scrollAbort?.abort();
  scrollAbort = new AbortController();

  let inner = ul.querySelector<HTMLDivElement>(':scope > div');
  if (!inner) {
    inner = document.createElement('div');
    ul.innerHTML = '';
    ul.appendChild(inner);
  }
  const vsInner = inner;

  function paint() {
    const h = groupListItemH;
    const scrollTop = ul.scrollTop;
    const viewH = ul.clientHeight || 500;
    const start = Math.max(0, Math.floor(scrollTop / h) - 5);
    const end = Math.min(visible.length - 1, Math.ceil((scrollTop + viewH) / h) + 5);
    vsInner.style.paddingTop = `${start * h}px`;
    vsInner.style.paddingBottom = `${Math.max(0, (visible.length - 1 - end) * h)}px`;
    vsInner.innerHTML = visible.slice(start, end + 1).map(groupItemHtml).join('');
    // Self-calibrate item height from first real item
    if (start === 0 && vsInner.firstElementChild) {
      const measured = (vsInner.firstElementChild as HTMLElement).offsetHeight;
      if (measured > 10) groupListItemH = measured;
    }
    reapplyGroupSelection();
  }

  let rafId = 0;
  ul.addEventListener('scroll', () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; paint(); });
  }, { passive: true, signal: scrollAbort.signal });

  ul.scrollTop = 0;
  paint();
}

function renderGroupDetail(group: DuplicateGroup) {
  const el = document.getElementById('group-detail')!;
  const multiCount = selectedGroupIds.size;

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

  const bulkBtn = multiCount > 1
    ? `<button class="ghost" data-action="auto-mark-all" style="font-size:12px;padding:5px 10px;color:#93c5fd;border-color:#1e3a5f">Auto-mark ${multiCount} selected <kbd style="font-size:10px;opacity:0.6">A</kbd></button>`
    : '';

  const kanbanToggle = multiCount > 1
    ? `<button class="ghost" data-action="toggle-kanban" style="font-size:12px;padding:5px 10px${kanbanMode ? ';color:#93c5fd;border-color:#1e3a5f' : ''}">${kanbanMode ? '☰ Detail' : '⊞ Kanban'}</button>`
    : '';

  const fileGridStyle = kanbanMode
    ? 'flex:1;display:flex;flex-direction:column;overflow:auto;padding:0;gap:0;background:#0a0a0a;min-height:0'
    : 'flex:1;display:flex;flex-direction:row;overflow-x:auto;gap:3px;padding:4px;background:#0d0d0d;min-height:0';

  el.innerHTML = `
    <div style="padding:10px 14px;border-bottom:1px solid #1e1e1e;display:flex;gap:8px;align-items:center;flex-shrink:0">
      <div style="flex:1;overflow:hidden">
        <span style="font-size:13px;font-weight:500">${group.files.length} files</span>
        <span style="font-size:11px;color:#666;margin-left:8px">${headerLabel}</span>
        ${multiCount > 1 ? `<span style="font-size:11px;color:#60a5fa;margin-left:8px">${multiCount} groups selected</span>` : ''}
      </div>
      ${kanbanToggle}
      ${bulkBtn}
      <div style="display:flex;gap:1px;position:relative">
        <button class="ghost" data-action="auto-mark" style="font-size:12px;padding:5px 10px;border-radius:4px 0 0 4px">
          Auto-mark${multiCount > 1 ? ' this' : ` (${autoMarkMode}) <kbd style="font-size:10px;opacity:0.6">A</kbd>`}
        </button>
        <button class="ghost" data-action="auto-mark-toggle" style="font-size:12px;padding:5px 7px;border-radius:0 4px 4px 0;border-left:1px solid #333">▾</button>
        <div id="am-dropdown" style="display:none;position:absolute;right:0;top:100%;z-index:200;background:#1e1e1e;border:1px solid #333;border-radius:4px;min-width:130px;padding:4px 0;margin-top:2px">
          <button class="ghost" data-action="am-select-priority" style="width:100%;text-align:left;padding:5px 12px;font-size:12px">By priority</button>
          <button class="ghost" data-action="am-select-quality" style="width:100%;text-align:left;padding:5px 12px;font-size:12px">By quality</button>
        </div>
      </div>
      <button class="ghost" data-action="keep-all" style="font-size:12px;padding:5px 10px">Keep all <kbd style="font-size:10px;opacity:0.6">K</kbd></button>
      <button class="ghost" data-action="delete-all" style="font-size:12px;padding:5px 10px;color:#fca5a5">Mark all <kbd style="font-size:10px;opacity:0.7">M</kbd></button>
    </div>
    <div id="file-grid" style="${fileGridStyle}"></div>
  `;

  el.querySelector('[data-action=toggle-kanban]')?.addEventListener('click', () => {
    kanbanMode = !kanbanMode;
    renderGroupDetail(group);
  });

  el.querySelector('[data-action=auto-mark-all]')?.addEventListener('click', () => autoMarkSelected());
  el.querySelector('[data-action=auto-mark]')!.addEventListener('click', () => autoMark(group));

  const amDropdown = el.querySelector<HTMLElement>('#am-dropdown')!;
  el.querySelector('[data-action=auto-mark-toggle]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    amDropdown.style.display = amDropdown.style.display === 'none' ? 'block' : 'none';
  });
  el.querySelector('[data-action=am-select-priority]')!.addEventListener('click', () => {
    autoMarkMode = 'priority';
    amDropdown.style.display = 'none';
    renderGroupDetail(group);
  });
  el.querySelector('[data-action=am-select-quality]')!.addEventListener('click', () => {
    autoMarkMode = 'quality';
    amDropdown.style.display = 'none';
    renderGroupDetail(group);
  });
  document.addEventListener('click', () => { amDropdown.style.display = 'none'; }, { once: true });

  el.querySelector('[data-action=keep-all]')!.addEventListener('click', () => {
    const targetIds = selectedGroupIds.size > 1 ? selectedGroupIds : new Set([group.id]);
    const targetGroups = groups.filter(g => targetIds.has(g.id));
    targetGroups.forEach(g => g.files.forEach(f => marked.delete(f.path)));
    if (kanbanMode) {
      refreshAllKanbanCells();
      targetGroups.forEach(g => updateGroupListItem(g));
    } else {
      renderComparisonPanel(group);
      updateGroupListItem(group);
    }
    updateBottomBar();
  });
  el.querySelector('[data-action=delete-all]')!.addEventListener('click', () => {
    const targetIds = selectedGroupIds.size > 1 ? selectedGroupIds : new Set([group.id]);
    const targetGroups = groups.filter(g => targetIds.has(g.id));
    targetGroups.forEach(g => g.files.forEach(f => marked.add(f.path)));
    if (kanbanMode) {
      refreshAllKanbanCells();
      targetGroups.forEach(g => updateGroupListItem(g));
    } else {
      renderComparisonPanel(group);
      updateGroupListItem(group);
    }
    updateBottomBar();
  });

  if (kanbanMode && multiCount > 1) {
    const selectedGroups = groups.filter(g => selectedGroupIds.has(g.id));
    renderKanbanView(selectedGroups);
  } else {
    renderComparisonPanel(group);
  }
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
             data-imgpath="${escapeAttr(f.path)}"
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
            <div style="font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:4px">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeAttr(f.path)}">${filename(f.path)}</span>
              <span class="res-badge"></span>
            </div>
            <div style="font-size:10px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                 title="${escapeAttr(f.path)}">${escapeAttr(f.path)}</div>
            <div style="font-size:10px;color:#888;display:flex;gap:6px">
              <span>${sizeMb} MB</span><span class="res-label"></span>
            </div>
          </div>
          <button class="${isMarked ? 'ghost' : 'primary'}" data-action="keep"
                  style="font-size:10px;padding:3px 8px;flex-shrink:0">Keep</button>
          <button class="${isMarked ? 'danger' : 'ghost'}" data-action="delete"
                  style="font-size:10px;padding:3px 8px;flex-shrink:0">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  // Read dimensions lazily from img.naturalWidth after load, then update best-res badge.
  const dimMap = new Map<string, { w: number; h: number }>();
  const imgs = grid.querySelectorAll<HTMLImageElement>('img[data-imgpath]');
  let pending = imgs.length;
  if (pending > 0) {
    function updateBadges() {
      let maxPx = 0;
      dimMap.forEach(({ w, h }) => { maxPx = Math.max(maxPx, w * h); });
      grid.querySelectorAll<HTMLElement>('[data-path]').forEach(card => {
        const dim = dimMap.get(card.dataset.path!);
        const px = dim ? dim.w * dim.h : 0;
        const best = maxPx > 0 && px === maxPx;
        const badge = card.querySelector<HTMLElement>('.res-badge')!;
        const label = card.querySelector<HTMLElement>('.res-label')!;
        badge.innerHTML = best ? `<span style="font-size:9px;font-weight:700;background:#854d0e;color:#fde68a;border-radius:3px;padding:1px 4px;flex-shrink:0">★ Best</span>` : '';
        if (dim) { label.textContent = `${dim.w}×${dim.h}`; label.style.color = best ? '#fde68a' : '#666'; }
      });
    }
    imgs.forEach(img => {
      function settle() {
        if (img.naturalWidth > 0) dimMap.set(img.dataset.imgpath!, { w: img.naturalWidth, h: img.naturalHeight });
        if (--pending === 0) updateBadges();
      }
      if (img.complete) settle();
      else { img.addEventListener('load', settle, { once: true }); img.addEventListener('error', settle, { once: true }); }
    });
  }

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
    if (kanbanMode) {
      refreshKanbanRow(group.id);
    } else {
      renderComparisonPanel(group);
    }
    updateGroupListItem(group);
    renderGroupList();
    updateBottomBar();
  } catch (e) {
    showToast(String(e));
  }
}

async function autoMarkSelected() {
  try {
    for (const id of selectedGroupIds) {
      const toMark = await api.autoMarkGroup(id, autoMarkMode);
      toMark.forEach(p => marked.add(p));
    }
    if (kanbanMode) {
      refreshAllKanbanCells();
      kanbanGroups.forEach(g => updateGroupListItem(g));
    } else {
      const previewGroup = groups.find(g => g.id === selectedGroupId);
      if (previewGroup) renderComparisonPanel(previewGroup);
    }
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
      const isMulti = selectedGroupIds.size > 1;
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        if (isMulti) autoMarkSelected();
        else autoMark(group);
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        const targets = isMulti ? groups.filter(g => selectedGroupIds.has(g.id)) : [group];
        targets.forEach(g => g.files.forEach(f => marked.delete(f.path)));
        if (kanbanMode) { refreshAllKanbanCells(); targets.forEach(g => updateGroupListItem(g)); }
        else { renderComparisonPanel(group); updateGroupListItem(group); }
        updateBottomBar();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        const targets = isMulti ? groups.filter(g => selectedGroupIds.has(g.id)) : [group];
        targets.forEach(g => g.files.forEach(f => marked.add(f.path)));
        if (kanbanMode) { refreshAllKanbanCells(); targets.forEach(g => updateGroupListItem(g)); }
        else { renderComparisonPanel(group); updateGroupListItem(group); }
        updateBottomBar();
      } else if (!isMulti) {
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
    selectedGroupIds.clear();
    lastClickedSortedIndex = -1;
    if (nextGroup) selectedGroupIds.add(nextGroup.id);
    renderGroupList();
    if (nextGroup) renderGroupDetail(nextGroup);
    updateBottomBar();
  } catch (e) {
    showToast(String(e));
  }
}

// ── Kanban view ──────────────────────────────────────────────────────────────

function assignToFolder(filePath: string, folders: string[]): number {
  const norm = filePath.replace(/\\/g, '/');
  let bestIdx = -1;
  let bestLen = -1;
  for (let i = 0; i < folders.length; i++) {
    const f = folders[i].replace(/\\/g, '/').replace(/\/$/, '');
    if (norm.startsWith(f + '/') || norm === f) {
      if (f.length > bestLen) { bestLen = f.length; bestIdx = i; }
    }
  }
  return bestIdx;
}

function kanbanThumbHtml(f: FileInfo, group: DuplicateGroup): string {
  const isMarked = marked.has(f.path);
  const survivors = group.files.filter(fi => !marked.has(fi.path)).length;
  const markedCount = group.files.length - survivors;
  const borderColor = isMarked ? '#7f1d1d' : markedCount > 0 ? '#1a3a28' : '#222';
  const stripBg = isMarked ? '#2d1515' : markedCount > 0 ? '#0f1f18' : '#141414';
  const isImage = f.media_type === 'image';
  const imageArea = isImage
    ? `<div style="height:100px;position:relative;overflow:hidden;background:#080808">
         <img src="${convertFileSrc(f.path)}" style="width:100%;height:100%;object-fit:contain" onerror="this.style.opacity='0.2'">
       </div>`
    : `<div style="height:60px;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#444;font-size:10px">▶ VIDEO</div>`;
  return `<div data-kanban-thumb data-path="${escapeAttr(f.path)}" data-group-id="${escapeAttr(group.id)}"
               style="border:2px solid ${borderColor};border-radius:4px;overflow:hidden;margin-bottom:3px;flex-shrink:0">
    ${imageArea}
    <div style="padding:2px 4px;background:${stripBg};display:flex;align-items:center;gap:3px">
      <span style="flex:1;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="${escapeAttr(f.path)}">${escapeAttr(filename(f.path))}</span>
      <button data-action="kanban-keep" data-path="${escapeAttr(f.path)}" data-group-id="${escapeAttr(group.id)}"
              class="${isMarked ? 'ghost' : 'primary'}" style="font-size:9px;padding:1px 4px;flex-shrink:0" title="Keep">✓</button>
      <button data-action="kanban-delete" data-path="${escapeAttr(f.path)}" data-group-id="${escapeAttr(group.id)}"
              class="${isMarked ? 'danger' : 'ghost'}" style="font-size:9px;padding:1px 4px;flex-shrink:0" title="Delete">✕</button>
    </div>
  </div>`;
}

function kanbanCellInner(group: DuplicateGroup, folderIdx: number): string {
  const files = group.files.filter(f => assignToFolder(f.path, folderPriorities) === folderIdx);
  if (files.length === 0) {
    return `<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#2a2a2a;font-size:16px;min-height:50px">—</div>`;
  }
  return files.map(f => kanbanThumbHtml(f, group)).join('');
}

function refreshKanbanRow(groupId: string) {
  document.querySelectorAll<HTMLElement>(`[data-kanban-cell][data-group-id="${groupId}"]`).forEach(cell => {
    const folderIdx = parseInt(cell.dataset.folderIdx!);
    const group = kanbanGroups.find(g => g.id === groupId);
    if (group) cell.innerHTML = kanbanCellInner(group, folderIdx);
  });
}

function refreshAllKanbanCells() {
  document.querySelectorAll<HTMLElement>('[data-kanban-cell]').forEach(cell => {
    const groupId = cell.dataset.groupId!;
    const folderIdx = parseInt(cell.dataset.folderIdx!);
    const group = kanbanGroups.find(g => g.id === groupId);
    if (group) cell.innerHTML = kanbanCellInner(group, folderIdx);
  });
}

function markKanbanColumn(folderIdx: number) {
  const colFiles: Array<{ file: FileInfo; group: DuplicateGroup }> = [];
  for (const g of kanbanGroups) {
    for (const f of g.files) {
      if (assignToFolder(f.path, folderPriorities) === folderIdx) colFiles.push({ file: f, group: g });
    }
  }
  const noSurvivorGroups = kanbanGroups.filter(g => {
    const wouldMark = new Set(marked);
    colFiles.filter(c => c.group.id === g.id).forEach(c => wouldMark.add(c.file.path));
    return g.files.every(f => wouldMark.has(f.path));
  });
  if (noSurvivorGroups.length > 0) {
    const n = noSurvivorGroups.length;
    if (!window.confirm(`Marking this column leaves ${n} group${n > 1 ? 's' : ''} with no survivors. Mark anyway?`)) return;
  }
  for (const { file, group } of colFiles) {
    marked.add(file.path);
    updateGroupListItem(group);
  }
  refreshAllKanbanCells();
  updateBottomBar();
}

function renderKanbanView(selectedGroups: DuplicateGroup[]) {
  kanbanGroups = selectedGroups;
  const grid = document.getElementById('file-grid')!;

  if (folderPriorities.length === 0) {
    grid.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;flex:1;color:#555;font-size:13px">No folder priorities — re-run a scan to enable kanban view</div>`;
    return;
  }

  const n = folderPriorities.length;
  const colMinWidth = 200;

  const headersHtml = folderPriorities.map((f, fi) => `
    <div style="position:sticky;top:0;z-index:10;background:#161616;border-bottom:2px solid #2a2a2a;border-right:1px solid #222;padding:6px 8px;display:flex;align-items:center;gap:4px">
      <span style="flex:1;font-size:10px;color:#888;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="${escapeAttr(f)}">${fi === 0 ? '★ ' : ''}${escapeAttr(f.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() || f)}</span>
      <button class="ghost" data-action="mark-col" data-col-idx="${fi}"
              style="font-size:9px;padding:2px 5px;color:#fca5a5;flex-shrink:0">✕ All</button>
    </div>
  `).join('');

  const rowsHtml = selectedGroups.map(g =>
    folderPriorities.map((_, fi) => `
      <div data-kanban-cell data-group-id="${escapeAttr(g.id)}" data-folder-idx="${fi}"
           style="border-bottom:1px solid #1a1a1a;border-right:1px solid #1e1e1e;padding:4px;display:flex;flex-direction:column;min-height:60px">
        ${kanbanCellInner(g, fi)}
      </div>
    `).join('')
  ).join('');

  grid.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(${n}, minmax(${colMinWidth}px, 1fr));min-width:${n * colMinWidth}px">
      ${headersHtml}
      ${rowsHtml}
    </div>
  `;

  grid.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action!;

    if (action === 'mark-col') {
      markKanbanColumn(parseInt(btn.dataset.colIdx!));
      return;
    }

    if (action !== 'kanban-keep' && action !== 'kanban-delete') return;
    const path = btn.dataset.path!;
    const groupId = btn.dataset.groupId!;
    const group = kanbanGroups.find(g => g.id === groupId);
    if (!group) return;

    if (action === 'kanban-keep') {
      marked.delete(path);
    } else {
      const survivors = group.files.filter(f => f.path !== path && !marked.has(f.path)).length;
      if (survivors === 0 && !window.confirm('Last copy — mark for deletion anyway?')) return;
      marked.add(path);
    }
    refreshKanbanRow(groupId);
    updateGroupListItem(group);
    updateBottomBar();
  });
}

// ── End kanban view ───────────────────────────────────────────────────────────

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
