import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useScanConfigStore } from '../stores/useScanConfigStore';

const GripIcon = () => (
  <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" style={{ display: 'block' }}>
    <circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/>
    <circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/>
    <circle cx="3" cy="11" r="1.2"/><circle cx="7" cy="11" r="1.2"/>
  </svg>
);

interface SortableFolderProps {
  folder: string;
  index: number;
}

export function SortableFolder({ folder, index }: SortableFolderProps) {
  const removeFolder = useScanConfigStore((s) => s.removeFolder);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: folder });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="flex items-center gap-1.5 px-2 py-1.5 bg-[#1a1a1a] rounded text-[12px] select-none"
    >
      <span className="text-[#555] flex-shrink-0 cursor-grab" {...attributes} {...listeners}>
        <GripIcon />
      </span>
      <span
        className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
        style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}
        title={folder}
      >
        {folder}
      </span>
      <button
        className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-2 py-0.5 text-[11px] cursor-pointer hover:bg-[#333]"
        onClick={() => removeFolder(index)}
      >
        ✕
      </button>
    </li>
  );
}
