import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ScanMode, VideoStrategy } from '../types';

interface ScanConfigState {
  folders: string[];
  mode: ScanMode;
  videoStrategy: VideoStrategy;
  threshold: number;
  ffmpegAvailable: boolean | null;
  addFolders: (paths: string[]) => void;
  removeFolder: (index: number) => void;
  reorderFolders: (from: number, to: number) => void;
  setMode: (mode: ScanMode) => void;
  setVideoStrategy: (strategy: VideoStrategy) => void;
  setThreshold: (threshold: number) => void;
  setFfmpegAvailable: (available: boolean) => void;
}

export const useScanConfigStore = create<ScanConfigState>()(
  persist(
    (set, get) => ({
      folders: [],
      mode: 'both',
      videoStrategy: 'first_frame',
      threshold: 8,
      ffmpegAvailable: null,
      addFolders: (paths) =>
        set((s) => ({ folders: [...s.folders, ...paths.filter((p) => !s.folders.includes(p))] })),
      removeFolder: (index) =>
        set((s) => ({ folders: s.folders.filter((_, i) => i !== index) })),
      reorderFolders: (from, to) =>
        set((s) => {
          const next = [...s.folders];
          const [item] = next.splice(from, 1);
          next.splice(to, 0, item);
          return { folders: next };
        }),
      setMode: (mode) => set({ mode }),
      setVideoStrategy: (videoStrategy) => set({ videoStrategy }),
      setThreshold: (threshold) => set({ threshold }),
      setFfmpegAvailable: (ffmpegAvailable) => set({ ffmpegAvailable }),
    }),
    {
      name: 'doope.scan-config',
      partialize: (state) => ({ folders: state.folders }),
    }
  )
);
