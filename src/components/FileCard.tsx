import { convertFileSrc } from '@tauri-apps/api/core';
import type { FileInfo } from '../types';

interface FileCardProps {
  file: FileInfo;
  isMarked: boolean;
  dim: { w: number; h: number } | undefined;
  isBest: boolean;
  isWarn: boolean;
  onLoad: (path: string, w: number, h: number) => void;
  onClickImage: () => void;
  onKeep: () => void;
  onDelete: () => void;
  onWarnConfirm: () => void;
  onWarnCancel: () => void;
}

export function FileCard({
  file: f,
  isMarked,
  dim,
  isBest,
  isWarn,
  onLoad,
  onClickImage,
  onKeep,
  onDelete,
  onWarnConfirm,
  onWarnCancel,
}: FileCardProps) {
  const isImage = f.media_type === 'image';
  const sizeMb = (f.size / 1_048_576).toFixed(2);
  const borderColor = isMarked ? '#7f1d1d' : '#1a3a28';
  const stripBg = isMarked ? '#2d1515' : '#0f1f18';

  return (
    <div
      className="flex-1 min-w-[180px] flex flex-col rounded overflow-hidden relative"
      style={{ border: `2px solid ${borderColor}` }}
    >
      {isImage ? (
        <div className="flex-1 relative min-h-0 overflow-hidden bg-[#080808]">
          <img
            src={convertFileSrc(f.path)}
            className="absolute inset-0 w-full h-full object-contain cursor-zoom-in"
            style={{ opacity: isMarked ? 0.5 : 1 }}
            onLoad={(e) => {
              const img = e.currentTarget;
              onLoad(f.path, img.naturalWidth, img.naturalHeight);
            }}
            onError={(e) => { e.currentTarget.style.opacity = '0.2'; }}
            onClick={onClickImage}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center bg-[#0a0a0a] text-[#444] text-[12px]">
          VIDEO
        </div>
      )}

      {isWarn && (
        <div className="absolute bottom-14 left-0 right-0 bg-[#7f1d1d] text-[#fca5a5] text-[11px] px-2.5 py-1.5 flex items-center gap-2 z-10">
          <span className="flex-1">Last copy — mark anyway?</span>
          <button
            className="bg-[#ef4444] text-white rounded px-2 py-0.5 text-[10px] hover:bg-[#dc2626]"
            onClick={onWarnConfirm}
          >
            Confirm
          </button>
          <button
            className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-2 py-0.5 text-[10px] hover:bg-[#333]"
            onClick={onWarnCancel}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="min-h-14 flex items-center gap-1.5 px-2 py-1 flex-shrink-0" style={{ background: stripBg }}>
        <div className="flex-1 overflow-hidden min-w-0">
          <div className="text-[11px] font-medium overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-1">
            <span className="overflow-hidden text-ellipsis whitespace-nowrap" title={f.path}>
              {f.path.split(/[\\/]/).pop()}
            </span>
            {isBest && (
              <span className="text-[9px] font-bold bg-[#854d0e] text-[#fde68a] rounded px-1 flex-shrink-0">
                ★ Best
              </span>
            )}
          </div>
          <div className="text-[10px] text-[#666] overflow-hidden text-ellipsis whitespace-nowrap" title={f.path}>
            {f.path}
          </div>
          <div className="text-[10px] text-[#888] flex gap-1.5">
            <span>{sizeMb} MB</span>
            {dim && <span style={{ color: isBest ? '#fde68a' : '#666' }}>{dim.w}×{dim.h}</span>}
          </div>
        </div>
        <button
          className={`text-[10px] px-2 py-0.5 rounded flex-shrink-0 ${
            isMarked
              ? 'bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] hover:bg-[#333]'
              : 'bg-[#3b82f6] text-white hover:bg-[#2563eb]'
          }`}
          onClick={onKeep}
        >
          Keep
        </button>
        <button
          className={`text-[10px] px-2 py-0.5 rounded flex-shrink-0 ${
            isMarked
              ? 'bg-[#ef4444] text-white hover:bg-[#dc2626]'
              : 'bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] hover:bg-[#333]'
          }`}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
