import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { DuplicateGroup, ProgressEvent, ScanOptions } from './types';

export const api = {
  scan: (options: ScanOptions) =>
    invoke<void>('scan', { options }),

  cancelScan: () =>
    invoke<void>('cancel_scan'),

  getDuplicateGroups: () =>
    invoke<DuplicateGroup[]>('get_duplicate_groups'),

  regroup: (threshold: number) =>
    invoke<void>('regroup', { threshold }),

  getFolderPriorities: () =>
    invoke<string[]>('get_folder_priorities'),

  setFolderPriorities: (priorities: string[]) =>
    invoke<void>('set_folder_priorities', { priorities }),

  autoMarkGroup: (groupId: string, mode: 'priority' | 'quality') =>
    invoke<string[]>('auto_mark_group', { groupId, mode }),

  deleteMarked: (pathsToDelete: string[], allowExtinction: boolean) =>
    invoke<string[]>('delete_marked', { pathsToDelete, allowExtinction }),

  clearCache: () =>
    invoke<void>('clear_cache'),

  checkFfmpeg: () =>
    invoke<boolean>('check_ffmpeg'),

  setScanPriority: (level: number) =>
    invoke<void>('set_scan_priority', { level }),

  onProgress: (cb: (evt: ProgressEvent) => void): Promise<UnlistenFn> =>
    listen<ProgressEvent>('progress', e => cb(e.payload)),

  onRegroupProgress: (cb: (phase: string) => void): Promise<UnlistenFn> =>
    listen<string>('regroup-progress', e => cb(e.payload)),
};
