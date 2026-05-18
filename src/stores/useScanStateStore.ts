import { create } from 'zustand';

interface ScanStateStore {
  lastPhashThreshold: number;
  lastFolderPriorities: string[];
  setScanState: (threshold: number, priorities: string[]) => void;
}

export const useScanStateStore = create<ScanStateStore>()((set) => ({
  lastPhashThreshold: 8,
  lastFolderPriorities: [],
  setScanState: (lastPhashThreshold, lastFolderPriorities) =>
    set({ lastPhashThreshold, lastFolderPriorities }),
}));
