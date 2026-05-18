import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { FileInfo } from '../types';

interface LightboxProps {
  imageFiles: FileInfo[];
  initialIndex: number;
  onClose: () => void;
}

export function Lightbox({ imageFiles, initialIndex, onClose }: LightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const fi = imageFiles[index];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) setIndex((i) => i - 1);
      if (e.key === 'ArrowRight' && index < imageFiles.length - 1) setIndex((i) => i + 1);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, imageFiles.length, onClose]);

  if (!fi) return null;

  return (
    <div
      id="lightbox-overlay"
      className="fixed inset-0 z-[1000] bg-black/[0.92] flex flex-col items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute top-3 right-3 flex gap-2 items-center">
        <span className="text-[12px] text-[#888]">{index + 1} / {imageFiles.length}</span>
        <button
          className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-3 py-1.5 text-[13px] hover:bg-[#333]"
          onClick={onClose}
        >
          ✕ Close
        </button>
      </div>
      <div
        className="absolute bottom-4 text-[12px] text-[#888] max-w-[80%] text-center overflow-hidden text-ellipsis whitespace-nowrap"
        title={fi.path}
      >
        {fi.path}
      </div>
      <button
        className="absolute left-3 top-1/2 -translate-y-1/2 bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-3.5 py-2.5 text-[18px] hover:bg-[#333]"
        style={{ opacity: index === 0 ? 0.2 : 1, cursor: index === 0 ? 'default' : 'pointer' }}
        onClick={() => index > 0 && setIndex((i) => i - 1)}
      >
        ‹
      </button>
      <img
        src={convertFileSrc(fi.path)}
        style={{
          maxWidth: 'calc(100vw - 120px)',
          maxHeight: 'calc(100vh - 80px)',
          objectFit: 'contain',
          borderRadius: 4,
        }}
      />
      <button
        className="absolute right-3 top-1/2 -translate-y-1/2 bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-3.5 py-2.5 text-[18px] hover:bg-[#333]"
        style={{
          opacity: index === imageFiles.length - 1 ? 0.2 : 1,
          cursor: index === imageFiles.length - 1 ? 'default' : 'pointer',
        }}
        onClick={() => index < imageFiles.length - 1 && setIndex((i) => i + 1)}
      >
        ›
      </button>
    </div>
  );
}
