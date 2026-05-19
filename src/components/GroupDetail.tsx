import type { DuplicateGroup } from '../types';
import { GroupDetailHeader } from './GroupDetailHeader';
import { ComparisonPanel } from './ComparisonPanel';
import { KanbanView } from './KanbanView';
import { useResultsStore } from '../stores/useResultsStore';

interface GroupDetailProps {
  group: DuplicateGroup;
  folderPriorities: string[];
}

export function GroupDetail({ group, folderPriorities }: GroupDetailProps) {
  const { kanbanMode, selectedGroupIds, groups } = useResultsStore();
  const multiCount = selectedGroupIds.size;
  const selectedGroups = groups.filter((g) => selectedGroupIds.has(g.id));

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

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <GroupDetailHeader group={group} headerLabel={headerLabel} />
      {kanbanMode && multiCount > 1 ? (
        <KanbanView groups={selectedGroups} folderPriorities={folderPriorities} />
      ) : (
        <ComparisonPanel group={group} />
      )}
    </div>
  );
}
