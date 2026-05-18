import { useEffect, useState } from 'react';
import type { ViewName } from '../App';
import { Toolbar } from '../components/Toolbar';
import { GroupList } from '../components/GroupList';
import { GroupListHeader } from '../components/GroupListHeader';
import { GroupDetail } from '../components/GroupDetail';
import { ResultsBottomBar } from '../components/ResultsBottomBar';
import { useResultsStore, filteredSortedGroups } from '../stores/useResultsStore';
import { useScanStateStore } from '../stores/useScanStateStore';
import { useToastStore } from '../stores/useToastStore';
import { useResultsKeys } from '../hooks/useResultsKeys';
import { api } from '../api';

interface ResultsProps {
  active: boolean;
  onNavigate: (v: ViewName) => void;
}

export function Results({ active, onNavigate }: ResultsProps) {
  const store = useResultsStore();
  const { lastPhashThreshold, lastFolderPriorities } = useScanStateStore();
  const { showToast } = useToastStore();
  const [currentThreshold, setCurrentThreshold] = useState(8);
  const [regrouping, setRegrouping] = useState(false);
  const [regroupStatus, setRegroupStatus] = useState('');

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

  const visible = filteredSortedGroups(store.groups, store.filterExt, store.sortMode);
  const selectedGroup = store.groups.find((g) => g.id === store.selectedGroupId) ?? null;

  const summaryLabel =
    store.groups.length === 0
      ? 'No duplicates found'
      : store.filterExt
        ? `${visible.length} of ${store.groups.length} group${store.groups.length !== 1 ? 's' : ''}`
        : `${store.groups.length} group${store.groups.length !== 1 ? 's' : ''} found`;

  function handleSelectGroup(id: string, index: number, shiftKey: boolean, ctrlKey: boolean) {
    if (shiftKey && store.lastClickedSortedIndex !== -1) {
      store.rangeSelectGroup(index, visible);
    } else if (ctrlKey) {
      store.toggleSelectedGroup(id);
    } else {
      store.setSelectedGroup(id, index);
    }
  }

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
          <GroupListHeader />
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

      <ResultsBottomBar />
    </div>
  );
}
