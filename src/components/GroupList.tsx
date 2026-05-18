import type { DuplicateGroup } from '../types';
import { GroupListItem } from './GroupListItem';
import { useResultsStore } from '../stores/useResultsStore';

interface GroupListProps {
  groups: DuplicateGroup[];
  indexOffset: number;
  onSelectGroup: (id: string, index: number, shiftKey: boolean, ctrlKey: boolean) => void;
}

export function GroupList({ groups, indexOffset, onSelectGroup }: GroupListProps) {
  const { marks, selectedGroupId, selectedGroupIds } = useResultsStore();

  return (
    <div className="flex-1 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#444_transparent]">
      {groups.map((g, i) => (
        <GroupListItem
          key={g.id}
          group={g}
          marks={marks}
          isSelected={g.id === selectedGroupId}
          isMultiSelected={selectedGroupIds.has(g.id)}
          onClick={(e) => onSelectGroup(g.id, indexOffset + i, e.shiftKey, e.ctrlKey || e.metaKey)}
        />
      ))}
    </div>
  );
}
