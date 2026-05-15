pub mod walker;
pub mod hasher;
pub mod video;
pub mod grouper;
pub mod bktree;

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
/// Cache reads happen inside par_iter; writes are batched into one transaction at the end.
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

    enum Outcome { Cached(FileRecord), New(FileRecord) }

    let outcomes: Vec<Option<Outcome>> = files
        .par_iter()
        .map(|found| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let path_str = found.path.to_string_lossy().to_string();

            // Cache reads only — no writes inside par_iter.
            {
                let c = cache.lock().unwrap();
                if let Ok(Some(cached)) = c.get(&path_str, found.size, found.mtime) {
                    let n = counter.fetch_add(1, Ordering::Relaxed) + 1;
                    progress_cb(ProgressEvent {
                        current: n,
                        total,
                        path: path_str,
                        phase: Phase::Hashing,
                    });
                    return Some(Outcome::Cached(cached));
                }
            }

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

            let n = counter.fetch_add(1, Ordering::Relaxed) + 1;
            progress_cb(ProgressEvent {
                current: n,
                total,
                path: path_str,
                phase: Phase::Hashing,
            });

            Some(Outcome::New(record))
        })
        .collect();

    let mut records: Vec<FileRecord> = Vec::with_capacity(outcomes.len());
    let mut new_records: Vec<FileRecord> = Vec::new();

    for outcome in outcomes.into_iter().flatten() {
        match outcome {
            Outcome::Cached(r) => records.push(r),
            Outcome::New(r) => {
                new_records.push(r.clone());
                records.push(r);
            }
        }
    }

    // Batch-write all newly computed records in one transaction.
    if !new_records.is_empty() {
        let c = cache.lock().unwrap();
        if let Err(e) = c.upsert_batch(&new_records) {
            errors.lock().unwrap().push(format!("cache batch write: {}", e));
        }
    }

    ScanResult {
        records,
        errors: Arc::try_unwrap(errors)
            .unwrap_or_else(|arc| Mutex::new(arc.lock().unwrap().clone()))
            .into_inner()
            .unwrap(),
    }
}
