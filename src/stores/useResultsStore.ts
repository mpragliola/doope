import { create } from 'zustand';
import type { DuplicateGroup, FileInfo } from '../types';

export type SortMode = 'default' | 'files-desc' | 'files-asc' | 'size-desc' | 'size-asc';

interface ResultsState {
  groups: DuplicateGroup[];
  marks: Set<string>;
  selectedGroupId: string | null;
  selectedGroupIds: Set<string>;
  lastClickedSortedIndex: number;
  sortMode: SortMode;
  filterExt: string | null;
  kanbanMode: boolean;
  autoMarkMode: 'priority' | 'quality';
  sidebarWidth: number;
  fileIndex: Map<string, FileInfo>;
  setGroups: (groups: DuplicateGroup[]) => void;
  markFile: (path: string) => void;
  unmarkFile: (path: string) => void;
  markAllPaths: (paths: string[]) => void;
  unmarkAllPaths: (paths: string[]) => void;
  setSelectedGroup: (id: string, sortedIndex: number) => void;
  toggleSelectedGroup: (id: string) => void;
  rangeSelectGroup: (toIndex: number, visibleGroups: DuplicateGroup[]) => void;
  setSortMode: (mode: SortMode) => void;
  setFilterExt: (ext: string | null) => void;
  setKanbanMode: (on: boolean) => void;
  setAutoMarkMode: (mode: 'priority' | 'quality') => void;
  setSidebarWidth: (w: number) => void;
  reset: () => void;
}

function buildFileIndex(groups: DuplicateGroup[]): Map<string, FileInfo> {
  const index = new Map<string, FileInfo>();
  for (const g of groups) for (const f of g.files) index.set(f.path, f);
  return index;
}

export const useResultsStore = create<ResultsState>()((set, get) => ({
  groups: [],
  marks: new Set(),
  selectedGroupId: null,
  selectedGroupIds: new Set(),
  lastClickedSortedIndex: -1,
  sortMode: 'default',
  filterExt: null,
  kanbanMode: false,
  autoMarkMode: 'priority',
  sidebarWidth: 280,
  fileIndex: new Map(),

  setGroups: (groups) => set({ groups, fileIndex: buildFileIndex(groups) }),

  markFile: (path) => set((s) => { const marks = new Set(s.marks); marks.add(path); return { marks }; }),
  unmarkFile: (path) => set((s) => { const marks = new Set(s.marks); marks.delete(path); return { marks }; }),
  markAllPaths: (paths) => set((s) => { const marks = new Set(s.marks); paths.forEach((p) => marks.add(p)); return { marks }; }),
  unmarkAllPaths: (paths) => set((s) => { const marks = new Set(s.marks); paths.forEach((p) => marks.delete(p)); return { marks }; }),

  setSelectedGroup: (id, sortedIndex) =>
    set({ selectedGroupId: id, selectedGroupIds: new Set([id]), lastClickedSortedIndex: sortedIndex }),

  toggleSelectedGroup: (id) =>
    set((s) => {
      const selectedGroupIds = new Set(s.selectedGroupIds);
      if (selectedGroupIds.has(id)) {
        selectedGroupIds.delete(id);
        const rem = [...selectedGroupIds];
        return { selectedGroupIds, selectedGroupId: rem.length > 0 ? rem[rem.length - 1] : null };
      } else {
        selectedGroupIds.add(id);
        return { selectedGroupIds, selectedGroupId: id };
      }
    }),

  rangeSelectGroup: (toIndex, visibleGroups) =>
    set((s) => {
      const lo = Math.min(s.lastClickedSortedIndex, toIndex);
      const hi = Math.max(s.lastClickedSortedIndex, toIndex);
      const selectedGroupIds = new Set(s.selectedGroupIds);
      for (let i = lo; i <= hi; i++) selectedGroupIds.add(visibleGroups[i].id);
      return { selectedGroupIds };
    }),

  setSortMode: (sortMode) => set({ sortMode }),
  setFilterExt: (filterExt) => set({ filterExt }),
  setKanbanMode: (kanbanMode) => set({ kanbanMode }),
  setAutoMarkMode: (autoMarkMode) => set({ autoMarkMode }),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),

  reset: () =>
    set({
      groups: [],
      marks: new Set(),
      selectedGroupId: null,
      selectedGroupIds: new Set(),
      lastClickedSortedIndex: -1,
      sortMode: 'default',
      filterExt: null,
      kanbanMode: false,
      fileIndex: new Map(),
    }),
}));

export function filteredSortedGroups(
  groups: DuplicateGroup[],
  filterExt: string | null,
  sortMode: SortMode
): DuplicateGroup[] {
  let base = groups;
  if (filterExt !== null) {
    base = base.filter((g) => g.files.every((f) => extOf(f.path) === filterExt));
  }
  const copy = [...base];
  if (sortMode === 'files-desc') copy.sort((a, b) => b.files.length - a.files.length);
  else if (sortMode === 'files-asc') copy.sort((a, b) => a.files.length - b.files.length);
  else if (sortMode === 'size-desc') copy.sort((a, b) => b.wasted_bytes - a.wasted_bytes);
  else if (sortMode === 'size-asc') copy.sort((a, b) => a.wasted_bytes - b.wasted_bytes);
  return copy;
}

export function extOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

export function availableExts(groups: DuplicateGroup[]): string[] {
  const s = new Set<string>();
  for (const g of groups) for (const f of g.files) { const e = extOf(f.path); if (e) s.add(e); }
  return [...s].sort();
}
