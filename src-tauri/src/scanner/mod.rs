pub mod walker;
pub mod hasher;
pub mod video;
pub mod grouper;
pub mod bktree;

use rayon::prelude::*;
use std::collections::HashMap;
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
/// Cache reads are bulk-fetched once before par_iter (zero lock contention during hashing).
/// Writes are batched into one transaction at the end.
pub fn run_phase1(
    options: &ScanOptions,
    cache: Arc<Mutex<Cache>>,
    cancel: Arc<AtomicBool>,
    progress_cb: impl Fn(ProgressEvent) + Send + Sync,
) -> ScanResult {
    progress_cb(ProgressEvent {
        current: 0,
        total: 0,
        path: String::new(),
        phase: Phase::Walking,
        cached: None,
    });

    let files = walk_folders(&options.folders, &cancel);
    let total = files.len();

    // Pre-compute path strings once; avoids repeated allocation inside par_iter.
    let path_strs: Vec<String> = files.iter()
        .map(|f| f.path.to_string_lossy().into_owned())
        .collect();

    // Single lock: bulk-fetch all potentially cached records in one SQLite query.
    // The resulting HashMap is Send + Sync — no locking needed during the parallel phase.
    let cache_snapshot: HashMap<String, FileRecord> = {
        let c = cache.lock().unwrap();
        let refs: Vec<&str> = path_strs.iter().map(String::as_str).collect();
        c.get_batch(&refs).unwrap_or_default()
    };

    let counter = Arc::new(AtomicUsize::new(0));
    let cached_count = Arc::new(AtomicUsize::new(0));
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));

    enum Outcome { Cached(FileRecord), New(FileRecord) }

    let outcomes: Vec<Option<Outcome>> = files
        .par_iter()
        .zip(path_strs.par_iter())
        .map(|(found, path_str)| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }

            // O(1) HashMap lookup — no lock, no SQLite round-trip.
            if let Some(cached) = cache_snapshot.get(path_str) {
                if cached.size == found.size && cached.mtime == found.mtime {
                    let n = counter.fetch_add(1, Ordering::Relaxed) + 1;
                    let nc = cached_count.fetch_add(1, Ordering::Relaxed) + 1;
                    progress_cb(ProgressEvent {
                        current: n,
                        total,
                        path: path_str.clone(),
                        phase: Phase::Hashing,
                        cached: Some(nc),
                    });
                    return Some(Outcome::Cached(cached.clone()));
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
                        video_phash(&found.path, &options.video_strategy, options.multi_frame_count, &cancel)
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
            let nc = cached_count.load(Ordering::Relaxed);
            progress_cb(ProgressEvent {
                current: n,
                total,
                path: path_str.clone(),
                phase: Phase::Hashing,
                cached: if nc > 0 { Some(nc) } else { None },
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
