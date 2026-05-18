import { useEffect, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import type { ViewName } from '../App';
import { Toolbar } from '../components/Toolbar';
import { GroupList } from '../components/GroupList';
import { GroupDetail } from '../components/GroupDetail';
import { useResultsStore, filteredSortedGroups, availableExts, type SortMode } from '../stores/useResultsStore';
import { useScanStateStore } from '../stores/useScanStateStore';
import { useToastStore } from '../stores/useToastStore';
import { useResultsKeys } from '../hooks/useResultsKeys';
import { api } from '../api';

interface ResultsProps {
  active: boolean;
  onNavigate: (v: ViewName) => void;
}

const SORT_OPTIONS: { label: string; value: SortMode }[] = [
  { label: 'Default', value: 'default' },
  { label: 'Files ↓', value: 'files-desc' },
  { label: 'Files ↑', value: 'files-asc' },
  { label: 'Size ↓', value: 'size-desc' },
  { label: 'Size ↑', value: 'size-asc' },
];

export function Results({ active, onNavigate }: ResultsProps) {
  const store = useResultsStore();
  const { lastPhashThreshold, lastFolderPriorities } = useScanStateStore();
  const { showToast } = useToastStore();
  const [currentThreshold, setCurrentThreshold] = useState(8);
  const [regrouping, setRegrouping] = useState(false);
  const [regroupStatus, setRegroupStatus] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useResultsKeys(active);

  useEffect(() => {
    const handler = () => loadResults();
    window.addEventListener('scan-complete', handler);
    return () => window.removeEventListener('scan-complete', handler);
  }, []);

  useEffect(() => {
    if (active) loadResults();
  }, [active]);

  async function loadResults() {
    try {
      const groups = await api.getDuplicateGroups();
      store.reset();
      store.setGroups(groups);
      setCurrentThreshold(lastPhashThreshold);
    } catch (e) {
      showToast(String(e));
    }
  }

  async function regroup() {
    setRegrouping(true);
    let unlisten: (() => void) | null = null;
    try {
      unlisten = await api.onRegroupProgress((phase) => {
        const labels: Record<string, string> = {
          filename: 'filename…',
          exact: 'exact hash…',
          perceptual: 'perceptual…',
        };
        setRegroupStatus(labels[phase] ?? phase);
      });
      await api.regroup(currentThreshold);
      const groups = await api.getDuplicateGroups();
      store.reset();
      store.setGroups(groups);
    } catch (e) {
      showToast(String(e));
    } finally {
      unlisten?.();
      setRegrouping(false);
      setRegroupStatus('');
    }
  }

  async function confirmDelete() {
    const paths = [...store.marks];
    const anyUnsafe = store.groups.some((g) => g.files.every((f) => store.marks.has(f.path)));
    try {
      await api.deleteMarked(paths, anyUnsafe);
      showToast(`Deleted ${paths.length} file${paths.length !== 1 ? 's' : ''}`, 'success');
      const groups = await api.getDuplicateGroups();
      store.reset();
      store.setGroups(groups);
    } catch (e) {
      showToast(String(e));
    }
    setShowDeleteConfirm(false);
  }

  const visible = filteredSortedGroups(store.groups, store.filterExt, store.sortMode);
  const exts = availableExts(store.groups);
  const selectedGroup = store.groups.find((g) => g.id === store.selectedGroupId) ?? null;
  const markedCount = store.marks.size;
  const anyUnsafe = store.groups.some((g) => g.files.every((f) => store.marks.has(f.path)));
  const totalMarkedBytes = [...store.marks].reduce(
    (sum, p) => sum + (store.fileIndex.get(p)?.size ?? 0),
    0
  );

  function handleSelectGroup(id: string, index: number, shiftKey: boolean, ctrlKey: boolean) {
    if (shiftKey && store.lastClickedSortedIndex !== -1) {
      store.rangeSelectGroup(index, visible);
    } else if (ctrlKey) {
      store.toggleSelectedGroup(id);
    } else {
      store.setSelectedGroup(id, index);
    }
  }

  let spaceLabel = 'No files marked for deletion';
  if (markedCount > 0) {
    const mb = (totalMarkedBytes / 1_048_576).toFixed(1);
    spaceLabel = anyUnsafe
      ? `⚠ ${markedCount} file${markedCount !== 1 ? 's' : ''} marked — some groups fully deleted (${mb} MB)`
      : `${markedCount} file${markedCount !== 1 ? 's' : ''} marked — ${mb} MB to free`;
  }

  const summaryLabel =
    store.groups.length === 0
      ? 'No duplicates found'
      : store.filterExt
        ? `${visible.length} of ${store.groups.length} group${store.groups.length !== 1 ? 's' : ''}`
        : `${store.groups.length} group${store.groups.length !== 1 ? 's' : ''} found`;

  return (
    <div className={active ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>
      <Toolbar>
        <h1 className="flex-1 text-[17px] font-semibold tracking-tight">Results</h1>
        <button
          className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-4 py-2 text-sm hover:bg-[#333]"
          onClick={() => { store.reset(); onNavigate('scan-config'); }}
        >
          ← New Scan
        </button>
        <span className="text-[13px] text-[#aaa]">{summaryLabel}</span>
      </Toolbar>

      <div className="flex items-center gap-2.5 px-4 py-2 bg-[#161616] border-b border-[#2a2a2a] flex-shrink-0">
        <span className="text-[12px] text-[#888]">Threshold:</span>
        <input
          type="range"
          min={0}
          max={20}
          value={currentThreshold}
          className="w-[110px] p-0"
          onChange={(e) => setCurrentThreshold(parseInt(e.target.value))}
        />
        <span className="text-[12px] min-w-[18px] text-[#e2e2e2]">{currentThreshold}</span>
        <button
          id="btn-regroup"
          className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-2.5 py-1.5 text-[12px] hover:bg-[#333] disabled:opacity-40 ml-auto"
          disabled={regrouping}
          onClick={regroup}
        >
          Re-group <kbd className="text-[10px] opacity-60">R</kbd>
        </button>
        {regroupStatus && <span className="text-[12px] text-[#666]">{regroupStatus}</span>}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div
          className="flex flex-col border-r border-[#2a2a2a] flex-shrink-0"
          style={{ width: store.sidebarWidth }}
        >
          <div className="px-3 py-1.5 text-[11px] text-[#666] border-b border-[#1e1e1e] flex items-center gap-1 flex-shrink-0">
            <span className="flex-1">DUPLICATE GROUPS</span>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-2 py-0.5 text-[11px] hover:bg-[#333]">
                  {store.filterExt ? `${store.filterExt} ▾` : 'Ext ▾'}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="bg-[#1e1e1e] border border-[#333] rounded py-1 min-w-[90px] max-h-[200px] overflow-y-auto z-50">
                  {[null, ...exts].map((ext) => (
                    <DropdownMenu.Item
                      key={ext ?? '__all'}
                      className="px-3 py-1.5 text-[11px] cursor-pointer outline-none hover:bg-[#2a2a2a]"
                      style={{ color: store.filterExt === ext ? '#e2e2e2' : '#888' }}
                      onSelect={() => store.setFilterExt(ext)}
                    >
                      {store.filterExt === ext ? '✓ ' : ''}{ext ?? 'All'}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-2 py-0.5 text-[11px] hover:bg-[#333]">
                  {store.sortMode === 'default'
                    ? 'Sort ▾'
                    : `Sort: ${SORT_OPTIONS.find((o) => o.value === store.sortMode)!.label} ▾`}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="bg-[#1e1e1e] border border-[#333] rounded py-1 min-w-[110px] z-50">
                  {SORT_OPTIONS.map((o) => (
                    <DropdownMenu.Item
                      key={o.value}
                      className="px-3 py-1.5 text-[11px] cursor-pointer outline-none hover:bg-[#2a2a2a]"
                      style={{
                        color: store.sortMode === o.value ? '#e2e2e2' : '#888',
                        background: store.sortMode === o.value ? '#2a2a2a' : undefined,
                      }}
                      onSelect={() => store.setSortMode(o.value)}
                    >
                      {store.sortMode === o.value ? '✓ ' : ''}{o.label}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>

          <GroupList groups={visible} onSelectGroup={handleSelectGroup} />
        </div>

        <div
          className="w-[5px] flex-shrink-0 cursor-col-resize hover:bg-[#3b82f6] transition-colors"
          onMouseDown={(e) => {
            const startX = e.clientX;
            const startW = store.sidebarWidth;
            const onMove = (mv: MouseEvent) => {
              store.setSidebarWidth(Math.min(600, Math.max(160, startW + mv.clientX - startX)));
            };
            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          }}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedGroup ? (
            <GroupDetail group={selectedGroup} folderPriorities={lastFolderPriorities} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-[#555] text-[14px]">
              Select a group to inspect
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-3 bg-[#1a1a1a] border-t border-[#2a2a2a] flex items-center gap-3 flex-shrink-0">
        <span className="flex-1 text-[13px] text-[#aaa]">{spaceLabel}</span>
        <AlertDialog.Root open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <AlertDialog.Trigger asChild>
            <button
              id="btn-delete"
              className="bg-[#ef4444] text-white rounded px-4 py-2 text-sm hover:bg-[#dc2626] disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={markedCount === 0}
            >
              Delete Marked <kbd className="text-[10px] opacity-70">Del</kbd>
            </button>
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 bg-black/60 z-[900]" />
            <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#1e1e1e] border border-[#333] rounded-lg p-6 max-w-[440px] w-full z-[901]">
              <AlertDialog.Title className="text-[15px] font-semibold mb-3">
                Confirm deletion
              </AlertDialog.Title>
              <AlertDialog.Description className="text-[13px] text-[#aaa] mb-6">
                {anyUnsafe
                  ? `Delete ${markedCount} file${markedCount !== 1 ? 's' : ''}? Some groups will have NO survivors — all copies will be lost. This cannot be undone.`
                  : `Delete ${markedCount} file${markedCount !== 1 ? 's' : ''}? This cannot be undone.`}
              </AlertDialog.Description>
              <div className="flex justify-end gap-3">
                <AlertDialog.Cancel asChild>
                  <button className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-4 py-2 text-sm hover:bg-[#333]">
                    Cancel
                  </button>
                </AlertDialog.Cancel>
                <AlertDialog.Action asChild>
                  <button
                    className="bg-[#ef4444] text-white rounded px-4 py-2 text-sm hover:bg-[#dc2626]"
                    onClick={confirmDelete}
                  >
                    Delete
                  </button>
                </AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
    </div>
  );
}
