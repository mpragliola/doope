import { convertFileSrc } from '@tauri-apps/api/core';
import { api } from '../api';
import { navigate, showToast } from '../main';
import type { DuplicateGroup, FileInfo } from '../types';

let groups: DuplicateGroup[] = [];
let marked = new Set<string>();
let selectedGroupId: string | null = null;

export function renderResults(el: HTMLElement) {
  el.innerHTML = `
    <div class="toolbar">
      <h1>Results</h1>
      <button class="ghost" id="btn-back">← New Scan</button>
      <span id="lbl-summary" style="font-size:13px;color:#aaa"></span>
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
    <div style="padding:12px 16px;background:#1a1a1a;border-top:1px solid #2a2a2a;display:flex;align-items:center;gap:12px">
      <span id="lbl-space" style="flex:1;font-size:13px;color:#aaa"></span>
      <button class="danger" id="btn-delete" disabled>Delete Marked</button>
    </div>
  `;

  el.querySelector('#btn-back')!.addEventListener('click', () => {
    groups = []; marked.clear(); selectedGroupId = null;
    navigate('scan-config');
  });
  el.querySelector('#btn-delete')!.addEventListener('click', confirmDelete);

  window.addEventListener('scan-complete', loadResults);
}

export async function loadResults() {
  groups = await api.getDuplicateGroups();
  marked.clear();
  selectedGroupId = null;
  renderGroupList();
  updateBottomBar();
}

function renderGroupList() {
  const ul = document.getElementById('group-list')!;
  const summary = document.getElementById('lbl-summary')!;

  summary.textContent = groups.length === 0
    ? 'No duplicates found'
    : `${groups.length} group${groups.length !== 1 ? 's' : ''} found`;

  ul.innerHTML = groups.map(g => {
    const wastedMb = (g.wasted_bytes / 1_048_576).toFixed(1);
    const badge = g.duplicate_type === 'exact' ? '=' : g.duplicate_type === 'perceptual' ? '~' : 'F';
    const badgeColor = g.duplicate_type === 'exact' ? '#3b82f6' : g.duplicate_type === 'perceptual' ? '#a855f7' : '#f59e0b';
    return `
      <li data-id="${g.id}" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid #1e1e1e;display:flex;flex-direction:column;gap:3px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="background:${badgeColor};color:#fff;font-size:10px;border-radius:3px;padding:1px 5px">${badge}</span>
          <span style="font-size:13px;font-weight:500">${g.files.length} files</span>
          <span style="font-size:11px;color:#666;margin-left:auto">${wastedMb} MB</span>
        </div>
        <div style="font-size:11px;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${shortPath(g.files[0]?.path ?? '')}
        </div>
      </li>
    `;
  }).join('');

  ul.querySelectorAll('li[data-id]').forEach(li => {
    li.addEventListener('click', () => {
      const htmlLi = li as HTMLElement;
      selectedGroupId = htmlLi.dataset.id!;
      ul.querySelectorAll('li').forEach(l => (l as HTMLElement).style.removeProperty('background'));
      htmlLi.style.background = '#1e2a3a';
      const group = groups.find(g => g.id === selectedGroupId);
      if (group) renderGroupDetail(group);
    });
  });
}

function renderGroupDetail(group: DuplicateGroup) {
  const el = document.getElementById('group-detail')!;
  el.innerHTML = `
    <div style="padding:10px 14px;border-bottom:1px solid #1e1e1e;display:flex;gap:8px;align-items:center">
      <span style="font-size:13px;font-weight:500;flex:1">Group: ${group.files.length} files</span>
      <button class="ghost" data-action="auto-mark" style="font-size:12px;padding:5px 10px">Auto-mark by priority</button>
      <button class="ghost" data-action="keep-all" style="font-size:12px;padding:5px 10px">Keep all</button>
      <button class="ghost" data-action="delete-all" style="font-size:12px;padding:5px 10px;color:#fca5a5">Mark all delete</button>
    </div>
    <div id="file-grid" class="scroll-list" style="padding:12px;display:flex;flex-direction:column;gap:8px"></div>
  `;

  el.querySelector('[data-action=auto-mark]')!.addEventListener('click', () => autoMark(group));
  el.querySelector('[data-action=keep-all]')!.addEventListener('click', () => {
    group.files.forEach(f => marked.delete(f.path));
    renderFileGrid(group);
    updateBottomBar();
  });
  el.querySelector('[data-action=delete-all]')!.addEventListener('click', () => {
    group.files.forEach(f => marked.add(f.path));
    renderFileGrid(group);
    updateBottomBar();
  });

  renderFileGrid(group);
}

function renderFileGrid(group: DuplicateGroup) {
  const grid = document.getElementById('file-grid')!;
  grid.innerHTML = group.files.map(f => {
    const isMarked = marked.has(f.path);
    const isImage = f.media_type === 'image';
    const sizeMb = (f.size / 1_048_576).toFixed(2);
    const thumb = isImage
      ? `<img src="${convertFileSrc(f.path)}" style="width:80px;height:60px;object-fit:cover;border-radius:4px;flex-shrink:0" onerror="this.style.display='none'">`
      : `<div style="width:80px;height:60px;background:#222;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#555;flex-shrink:0">VIDEO</div>`;
    return `
      <div data-path="${escapeAttr(f.path)}" style="display:flex;align-items:center;gap:12px;padding:10px;background:${isMarked ? '#2d1515' : '#181818'};border:1px solid ${isMarked ? '#7f1d1d' : '#252525'};border-radius:6px">
        ${thumb}
        <div style="flex:1;overflow:hidden;min-width:0">
          <div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${filename(f.path)}</div>
          <div style="font-size:11px;color:#666;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeAttr(f.path)}">${f.path}</div>
          <div style="font-size:11px;color:#888;margin-top:2px">${sizeMb} MB</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
          <button class="${isMarked ? 'ghost' : 'primary'}" data-action="keep" style="font-size:11px;padding:4px 10px">Keep</button>
          <button class="${isMarked ? 'danger' : 'ghost'}" data-action="delete" style="font-size:11px;padding:4px 10px">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('[data-path]').forEach(row => {
    const path = (row as HTMLElement).dataset.path!;
    row.querySelector('[data-action=keep]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      marked.delete(path);
      renderFileGrid(group);
      updateBottomBar();
    });
    row.querySelector('[data-action=delete]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      marked.add(path);
      renderFileGrid(group);
      updateBottomBar();
    });
  });
}

async function autoMark(group: DuplicateGroup) {
  try {
    const toMark = await api.autoMarkGroup(group.id);
    toMark.forEach(p => marked.add(p));
    renderFileGrid(group);
    updateBottomBar();
  } catch (e) {
    showToast(String(e));
  }
}

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
