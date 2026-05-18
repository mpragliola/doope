use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MediaType {
    Image,
    Video,
}

impl MediaType {
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "tiff" | "tif" | "heic" | "avif" => {
                Some(MediaType::Image)
            }
            "mp4" | "mov" | "avi" | "mkv" | "wmv" | "flv" | "webm" | "m4v" | "3gp" => {
                Some(MediaType::Video)
            }
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum VideoStrategy {
    ExactOnly,
    FirstFrame,
    MultiFrame,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ScanMode {
    Filename,
    Content,
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanOptions {
    pub folders: Vec<String>,
    pub mode: ScanMode,
    pub video_strategy: VideoStrategy,
    pub phash_threshold: u32,
    pub folder_priorities: Vec<String>,
    pub multi_frame_count: usize,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            folders: vec![],
            mode: ScanMode::Both,
            video_strategy: VideoStrategy::FirstFrame,
            phash_threshold: 8,
            folder_priorities: vec![],
            multi_frame_count: 8,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileRecord {
    pub path: String,
    pub size: u64,
    pub mtime: u64,
    pub exact_hash: Option<String>,
    pub phash: Option<String>,
    pub media_type: MediaType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateType {
    Exact,
    Perceptual,
    Filename,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub size: u64,
    pub media_type: MediaType,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateGroup {
    pub id: String,
    pub files: Vec<FileInfo>,
    pub duplicate_type: DuplicateType,
    pub wasted_bytes: u64,
    pub max_distance: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Walking,
    Hashing,
    Grouping,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressEvent {
    pub current: usize,
    pub total: usize,
    pub path: String,
    pub phase: Phase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cached: Option<usize>,
    /// Extension counts (without leading dot) for files processed in this batch.
    /// Only set on throttled cache-hit events to compensate for skipped per-file events.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext_deltas: Option<HashMap<String, u32>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_type_from_extension() {
        assert_eq!(MediaType::from_extension("jpg"), Some(MediaType::Image));
        assert_eq!(MediaType::from_extension("MP4"), Some(MediaType::Video));
        assert_eq!(MediaType::from_extension("txt"), None);
    }

    #[test]
    fn scan_options_default() {
        let opts = ScanOptions::default();
        assert_eq!(opts.phash_threshold, 8);
        assert_eq!(opts.multi_frame_count, 8);
    }

    #[test]
    fn duplicate_group_has_max_distance_field() {
        let g = DuplicateGroup {
            id: "x".to_string(),
            files: vec![],
            duplicate_type: DuplicateType::Perceptual,
            wasted_bytes: 0,
            max_distance: Some(3),
        };
        assert_eq!(g.max_distance, Some(3));
    }
}
