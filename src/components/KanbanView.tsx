import type { DuplicateGroup, FileInfo } from '../types';
import { KanbanThumb } from './KanbanThumb';
import { useResultsStore } from '../stores/useResultsStore';

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

interface KanbanViewProps {
  groups: DuplicateGroup[];
  folderPriorities: string[];
}

export function KanbanView({ groups, folderPriorities }: KanbanViewProps) {
  const { marks, markFile, unmarkFile } = useResultsStore();

  if (folderPriorities.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#555] text-[13px]">
        No folder priorities — re-run a scan to enable kanban view
      </div>
    );
  }

  function markColumn(folderIdx: number) {
    const colFiles: Array<{ file: FileInfo; group: DuplicateGroup }> = [];
    for (const g of groups) {
      for (const f of g.files) {
        if (assignToFolder(f.path, folderPriorities) === folderIdx) colFiles.push({ file: f, group: g });
      }
    }
    const noSurvivorGroups = groups.filter((g) => {
      const wouldMark = new Set(marks);
      colFiles.filter((c) => c.group.id === g.id).forEach((c) => wouldMark.add(c.file.path));
      return g.files.every((fi) => wouldMark.has(fi.path));
    });
    if (noSurvivorGroups.length > 0) {
      const n = noSurvivorGroups.length;
      if (!window.confirm(`Marking this column leaves ${n} group${n > 1 ? 's' : ''} with no survivors. Mark anyway?`)) return;
    }
    colFiles.forEach(({ file }) => markFile(file.path));
  }

  function handleFileToggle(file: FileInfo, group: DuplicateGroup, keepAction: boolean) {
    if (keepAction) {
      unmarkFile(file.path);
    } else {
      const survivors = group.files.filter((f) => f.path !== file.path && !marks.has(f.path)).length;
      if (survivors === 0 && !window.confirm('Last copy — mark for deletion anyway?')) return;
      markFile(file.path);
    }
  }

  const n = folderPriorities.length;
  const colMinWidth = 200;

  return (
    <div className="flex-1 overflow-auto bg-[#0a0a0a]">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${n}, minmax(${colMinWidth}px, 1fr))`,
          minWidth: n * colMinWidth,
        }}
      >
        {folderPriorities.map((f, fi) => (
          <div
            key={fi}
            className="sticky top-0 z-10 bg-[#161616] border-b-2 border-b-[#2a2a2a] border-r border-r-[#222] px-2 py-1.5 flex items-center gap-1"
          >
            <span
              className="flex-1 text-[10px] text-[#888] font-semibold overflow-hidden text-ellipsis whitespace-nowrap"
              title={f}
            >
              {fi === 0 ? '★ ' : ''}
              {f.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() || f}
            </span>
            <button
              className="text-[9px] px-1.5 py-0.5 bg-[#2a2a2a] text-[#fca5a5] border border-[#444] rounded hover:bg-[#333] flex-shrink-0"
              onClick={() => markColumn(fi)}
            >
              ✕ All
            </button>
          </div>
        ))}

        {groups.map((g) =>
          folderPriorities.map((_, fi) => {
            const files = g.files.filter((f) => assignToFolder(f.path, folderPriorities) === fi);
            return (
              <div
                key={`${g.id}-${fi}`}
                className="border-b border-b-[#1a1a1a] border-r border-r-[#1e1e1e] p-1 flex flex-col min-h-[60px]"
              >
                {files.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-[#2a2a2a] text-[16px] min-h-[50px]">—</div>
                ) : (
                  files.map((f) => (
                    <KanbanThumb
                      key={f.path}
                      file={f}
                      isMarked={marks.has(f.path)}
                      onKeep={() => handleFileToggle(f, g, true)}
                      onDelete={() => handleFileToggle(f, g, false)}
                    />
                  ))
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
