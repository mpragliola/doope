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

  setFolderPriorities: (priorities: string[]) =>
    invoke<void>('set_folder_priorities', { priorities }),

  autoMarkGroup: (groupId: string) =>
    invoke<string[]>('auto_mark_group', { groupId }),

  deleteMarked: (pathsToDelete: string[]) =>
    invoke<string[]>('delete_marked', { pathsToDelete }),

  clearCache: () =>
    invoke<void>('clear_cache'),

  checkFfmpeg: () =>
    invoke<boolean>('check_ffmpeg'),

  onProgress: (cb: (evt: ProgressEvent) => void): Promise<UnlistenFn> =>
    listen<ProgressEvent>('progress', e => cb(e.payload)),
};
