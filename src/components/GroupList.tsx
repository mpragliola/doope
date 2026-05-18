import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DuplicateGroup } from '../types';
import { GroupListItem } from './GroupListItem';
import { useResultsStore } from '../stores/useResultsStore';

interface GroupListProps {
  groups: DuplicateGroup[];
  onSelectGroup: (id: string, index: number, shiftKey: boolean, ctrlKey: boolean) => void;
}

export function GroupList({ groups, onSelectGroup }: GroupListProps) {
  const { marks, selectedGroupId, selectedGroupIds } = useResultsStore();
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 5,
  });

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#444_transparent]"
    >
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const g = groups[item.index];
          return (
            <GroupListItem
              key={g.id}
              group={g}
              marks={marks}
              isSelected={g.id === selectedGroupId}
              isMultiSelected={selectedGroupIds.has(g.id)}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}
              onClick={(e) => onSelectGroup(g.id, item.index, e.shiftKey, e.ctrlKey || e.metaKey)}
            />
          );
        })}
      </div>
    </div>
  );
}
