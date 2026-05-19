import { convertFileSrc } from '@tauri-apps/api/core';
import type { FileInfo } from '../types';

interface KanbanThumbProps {
  file: FileInfo;
  isMarked: boolean;
  onKeep: () => void;
  onDelete: () => void;
}

export function KanbanThumb({ file: f, isMarked, onKeep, onDelete }: KanbanThumbProps) {
  const isImage = f.media_type === 'image';
  const borderColor = isMarked ? '#7f1d1d' : '#222';
  const stripBg = isMarked ? '#2d1515' : '#141414';

  return (
    <div
      className="rounded overflow-hidden mb-[3px] flex-shrink-0"
      style={{ border: `2px solid ${borderColor}` }}
    >
      {isImage ? (
        <div className="h-[100px] relative overflow-hidden bg-[#080808]">
          <img
            src={convertFileSrc(f.path)}
            className="w-full h-full object-contain"
            onError={(e) => { e.currentTarget.style.opacity = '0.2'; }}
          />
        </div>
      ) : (
        <div className="h-[60px] flex items-center justify-center bg-[#0a0a0a] text-[#444] text-[10px]">
          ▶ VIDEO
        </div>
      )}
      <div className="px-1 py-0.5 flex items-center gap-[3px]" style={{ background: stripBg }}>
        <span
          className="flex-1 text-[9px] overflow-hidden text-ellipsis whitespace-nowrap"
          title={f.path}
        >
          {f.path.split(/[\\/]/).pop()}
        </span>
        <button
          className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 ${!isMarked ? 'bg-[#3b82f6] text-white' : 'bg-[#2a2a2a] text-[#e2e2e2] border border-[#444]'}`}
          title="Keep"
          onClick={onKeep}
        >
          ✓
        </button>
        <button
          className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 ${isMarked ? 'bg-[#ef4444] text-white' : 'bg-[#2a2a2a] text-[#e2e2e2] border border-[#444]'}`}
          title="Delete"
          onClick={onDelete}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
