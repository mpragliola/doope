export type MediaType = 'image' | 'video';
export type DuplicateType = 'exact' | 'perceptual' | 'filename';
export type Phase = 'walking' | 'hashing' | 'grouping' | 'done';
export type ScanMode = 'filename' | 'content' | 'both';
export type VideoStrategy = 'exact_only' | 'first_frame' | 'multi_frame';

export interface ScanOptions {
  folders: string[];
  mode: ScanMode;
  video_strategy: VideoStrategy;
  phash_threshold: number;
  folder_priorities: string[];
  multi_frame_count: number;
}

export interface FileInfo {
  path: string;
  size: number;
  media_type: MediaType;
  width?: number;
  height?: number;
}

export interface DuplicateGroup {
  id: string;
  files: FileInfo[];
  duplicate_type: DuplicateType;
  wasted_bytes: number;
  max_distance?: number;
}

export interface ProgressEvent {
  current: number;
  total: number;
  path: string;
  phase: Phase;
  cached?: number;
}
