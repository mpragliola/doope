pub mod walker;
pub mod hasher;
pub mod video;
pub mod grouper;

use rayon::prelude::*;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use crate::cache::Cache;
use crate::models::{FileRecord, MediaType, Phase, ProgressEvent, ScanMode, ScanOptions};
use walker::walk_folders;
use hasher::{blake3_hash, dhash_path};
use video::video_phash;

pub struct ScanResult {
    pub records: Vec<FileRecord>,
    pub errors: Vec<String>,
}

/// Phase 1: walk folders, hash files in parallel, populate cache.
/// `progress_cb` is called after each file.
/// Set `cancel` to true to stop early.
pub fn run_phase1(
    options: &ScanOptions,
    cache: Arc<Mutex<Cache>>,
    cancel: Arc<AtomicBool>,
    progress_cb: impl Fn(ProgressEvent) + Send + Sync,
) -> ScanResult {
    let files = walk_folders(&options.folders);
    let total = files.len();
    let counter = Arc::new(AtomicUsize::new(0));
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));

    let records: Vec<Option<FileRecord>> = files
        .par_iter()
        .map(|found| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let path_str = found.path.to_string_lossy().to_string();

            // Cache check
            {
                let c = cache.lock().unwrap();
                if let Ok(Some(cached)) = c.get(&path_str, found.size, found.mtime) {
                    let n = counter.fetch_add(1, Ordering::Relaxed) + 1;
                    progress_cb(ProgressEvent {
                        current: n,
                        total,
                        path: path_str.clone(),
                        phase: Phase::Hashing,
                    });
                    return Some(cached);
                }
            }

            // Compute hashes
            let exact_hash = match blake3_hash(&found.path) {
                Ok(h) => Some(h),
                Err(e) => {
                    errors.lock().unwrap().push(format!("{}: {}", path_str, e));
                    None
                }
            };

            let phash = match &found.media_type {
                MediaType::Image => {
                    if matches!(options.mode, ScanMode::Content | ScanMode::Both) {
                        dhash_path(&found.path).ok()
                    } else {
                        None
                    }
                }
                MediaType::Video => {
                    if matches!(options.mode, ScanMode::Content | ScanMode::Both) {
                        video_phash(&found.path, &options.video_strategy, options.multi_frame_count)
                    } else {
                        None
                    }
                }
            };

            let record = FileRecord {
                path: path_str.clone(),
                size: found.size,
                mtime: found.mtime,
                exact_hash,
                phash,
                media_type: found.media_type.clone(),
            };

            // Update cache
            {
                let c = cache.lock().unwrap();
                if let Err(e) = c.upsert(&record) {
                    errors.lock().unwrap().push(format!("cache write {}: {}", path_str, e));
                }
            }

            let n = counter.fetch_add(1, Ordering::Relaxed) + 1;
            progress_cb(ProgressEvent {
                current: n,
                total,
                path: path_str,
                phase: Phase::Hashing,
            });

            Some(record)
        })
        .collect();

    ScanResult {
        records: records.into_iter().flatten().collect(),
        errors: Arc::try_unwrap(errors)
            .unwrap_or_else(|arc| Mutex::new(arc.lock().unwrap().clone()))
            .into_inner()
            .unwrap(),
    }
}
