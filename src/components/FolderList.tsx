import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableFolder } from './SortableFolder';
import { useScanConfigStore } from '../stores/useScanConfigStore';
import { useToastStore } from '../stores/useToastStore';

export function FolderList() {
  const { folders, reorderFolders, addFolders } = useScanConfigStore();
  const { showToast } = useToastStore();
  const [isDragOver, setIsDragOver] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = folders.indexOf(active.id as string);
    const to = folders.indexOf(over.id as string);
    if (from === -1 || to === -1) return;
    reorderFolders(from, to);
  }

  async function handleAdd() {
    try {
      const selected = await open({ multiple: true, directory: true });
      if (!selected) return;
      addFolders(Array.isArray(selected) ? selected : [selected]);
    } catch (e) {
      showToast(String(e));
    }
  }

  function handleDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setIsDragOver(false);
    const added: string[] = [];
    for (const item of Array.from(e.dataTransfer.items)) {
      const entry = item.webkitGetAsEntry?.();
      if (!entry?.isDirectory) continue;
      const path: string | undefined = (item.getAsFile() as any)?.path;
      if (path) added.push(path);
    }
    if (added.length) {
      addFolders(added);
    } else {
      showToast('Drop folders, not files', 'error');
    }
  }

  return (
    <div
      className={`w-[340px] flex flex-col border-r p-4 gap-3 transition-colors flex-shrink-0 ${
        isDragOver ? 'border-[#3b82f6] bg-[rgba(59,130,246,0.07)]' : 'border-[#2a2a2a]'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 font-semibold">Folders</span>
        <span className="text-[11px] text-[#555]">drag to reorder · drop to add</span>
        <button
          className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded py-1.5 px-3 text-[12px] hover:bg-[#333]"
          onClick={handleAdd}
        >
          + Add
        </button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={folders} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-1 overflow-y-auto flex-1 [scrollbar-width:thin] [scrollbar-color:#444_transparent]">
            {folders.map((f, i) => (
              <SortableFolder key={f} folder={f} index={i} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}
