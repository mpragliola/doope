import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { DuplicateGroup } from '../types';
import { ComparisonPanel } from './ComparisonPanel';
import { KanbanView } from './KanbanView';
import { useResultsStore } from '../stores/useResultsStore';
import { useToastStore } from '../stores/useToastStore';
import { api } from '../api';

interface GroupDetailProps {
  group: DuplicateGroup;
  folderPriorities: string[];
}

export function GroupDetail({ group, folderPriorities }: GroupDetailProps) {
  const store = useResultsStore();
  const { showToast } = useToastStore();
  const multiCount = store.selectedGroupIds.size;
  const selectedGroups = store.groups.filter((g) => store.selectedGroupIds.has(g.id));

  async function autoMark(targets: DuplicateGroup[]) {
    try {
      for (const g of targets) {
        const toMark = await api.autoMarkGroup(g.id, store.autoMarkMode);
        store.markAllPaths(toMark);
      }
    } catch (e) {
      showToast(String(e));
    }
  }

  function keepAll(targets: DuplicateGroup[]) {
    targets.forEach((g) => store.unmarkAllPaths(g.files.map((f) => f.path)));
  }

  function markAll(targets: DuplicateGroup[]) {
    targets.forEach((g) => store.markAllPaths(g.files.map((f) => f.path)));
  }

  const showKanban = store.kanbanMode && multiCount > 1;

  let headerLabel = '';
  if (group.duplicate_type === 'perceptual') {
    headerLabel =
      group.max_distance === 0
        ? 'Perceptual identical (distance: 0)'
        : `Perceptual similar (distance: ${group.max_distance ?? '?'})`;
  } else if (group.duplicate_type === 'exact') {
    headerLabel = 'Exact duplicates';
  } else {
    headerLabel = 'Filename match';
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-[#1e1e1e] flex gap-2 items-center flex-shrink-0">
        <div className="flex-1 overflow-hidden">
          <span className="text-[13px] font-medium">{group.files.length} files</span>
          <span className="text-[11px] text-[#666] ml-2">{headerLabel}</span>
          {multiCount > 1 && (
            <span className="text-[11px] text-[#60a5fa] ml-2">{multiCount} groups selected</span>
          )}
        </div>

        {multiCount > 1 && (
          <button
            className={`bg-[#2a2a2a] border rounded px-2.5 py-1.5 text-[12px] hover:bg-[#333] ${
              store.kanbanMode ? 'text-[#93c5fd] border-[#1e3a5f]' : 'text-[#e2e2e2] border-[#444]'
            }`}
            onClick={() => store.setKanbanMode(!store.kanbanMode)}
          >
            {store.kanbanMode ? '☰ Detail' : '⊞ Kanban'}
          </button>
        )}

        {multiCount > 1 && (
          <button
            className="bg-[#2a2a2a] text-[#93c5fd] border border-[#1e3a5f] rounded px-2.5 py-1.5 text-[12px] hover:bg-[#333]"
            onClick={() => autoMark(selectedGroups)}
          >
            Auto-mark {multiCount} selected <kbd className="text-[10px] opacity-60">A</kbd>
          </button>
        )}

        <div className="flex gap-px relative">
          <button
            className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded-l px-2.5 py-1.5 text-[12px] hover:bg-[#333]"
            onClick={() => autoMark(multiCount > 1 ? selectedGroups : [group])}
          >
            Auto-mark{multiCount > 1 ? ' this' : ` (${store.autoMarkMode})`}
            {multiCount <= 1 && <kbd className="text-[10px] opacity-60 ml-1">A</kbd>}
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="bg-[#2a2a2a] text-[#e2e2e2] border border-l-[#333] border-[#444] rounded-r px-2 py-1.5 text-[12px] hover:bg-[#333]">
                ▾
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="bg-[#1e1e1e] border border-[#333] rounded py-1 min-w-[130px] z-50">
                <DropdownMenu.Item
                  className="px-3 py-1.5 text-[12px] text-[#e2e2e2] cursor-pointer outline-none hover:bg-[#2a2a2a]"
                  onSelect={() => store.setAutoMarkMode('priority')}
                >
                  By priority
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="px-3 py-1.5 text-[12px] text-[#e2e2e2] cursor-pointer outline-none hover:bg-[#2a2a2a]"
                  onSelect={() => store.setAutoMarkMode('quality')}
                >
                  By quality
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        <button
          className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-2.5 py-1.5 text-[12px] hover:bg-[#333]"
          onClick={() => keepAll(multiCount > 1 ? selectedGroups : [group])}
        >
          Keep all <kbd className="text-[10px] opacity-60">K</kbd>
        </button>
        <button
          className="bg-[#2a2a2a] text-[#fca5a5] border border-[#444] rounded px-2.5 py-1.5 text-[12px] hover:bg-[#333]"
          onClick={() => markAll(multiCount > 1 ? selectedGroups : [group])}
        >
          Mark all <kbd className="text-[10px] opacity-70">M</kbd>
        </button>
      </div>

      {showKanban ? (
        <KanbanView groups={selectedGroups} folderPriorities={folderPriorities} />
      ) : (
        <ComparisonPanel group={group} />
      )}
    </div>
  );
}
