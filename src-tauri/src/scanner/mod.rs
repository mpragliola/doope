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
    pub cache_hits: usize,
    pub cache_misses: usize,
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
        ext_deltas: None,
    });

    let files = walk_folders(&options.folders, &cancel);
    let total = files.len();

    // Tell the UI how many files were found so it can stop looking frozen.
    progress_cb(ProgressEvent {
        current: 0,
        total,
        path: String::new(),
        phase: Phase::Walking,
        cached: None,
        ext_deltas: None,
    });

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
    let ext_accumulator: Arc<Mutex<HashMap<String, u32>>> = Arc::new(Mutex::new(HashMap::new()));

    enum Outcome { Cached(FileRecord), New(FileRecord) }

    let ext_acc = Arc::clone(&ext_accumulator);
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
                    let ext = std::path::Path::new(path_str.as_str())
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    ext_acc.lock().unwrap().entry(ext).and_modify(|c| *c += 1).or_insert(1);

                    let n = counter.fetch_add(1, Ordering::Relaxed) + 1;
                    let nc = cached_count.fetch_add(1, Ordering::Relaxed) + 1;
                    // Cache hits are near-instant; emitting every file floods the IPC queue.
                    // Emit every 200 to keep the UI responsive without backlog buildup.
                    // Drain the ext accumulator so the frontend can count all files, not just
                    // the one whose path is in the event.
                    if n % 200 == 0 || n == total {
                        let deltas = std::mem::take(&mut *ext_acc.lock().unwrap());
                        progress_cb(ProgressEvent {
                            current: n,
                            total,
                            path: path_str.clone(),
                            phase: Phase::Hashing,
                            cached: Some(nc),
                            ext_deltas: if deltas.is_empty() { None } else { Some(deltas) },
                        });
                    }
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
                ext_deltas: None,
            });

            Some(Outcome::New(record))
        })
        .collect();

    // After collect() all par_iter tasks are done. Drain any ext counts that raced past the
    // last batch event's drain (possible due to relaxed atomic ordering in par_iter).
    let remaining_deltas = std::mem::take(&mut *ext_accumulator.lock().unwrap());
    if !remaining_deltas.is_empty() {
        let n = counter.load(Ordering::Relaxed);
        let nc = cached_count.load(Ordering::Relaxed);
        progress_cb(ProgressEvent {
            current: n,
            total,
            path: String::new(),
            phase: Phase::Hashing,
            cached: if nc > 0 { Some(nc) } else { None },
            ext_deltas: Some(remaining_deltas),
        });
    }

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

    let hits = cached_count.load(Ordering::Relaxed);
    let misses = new_records.len();
    println!(
        "[cache] hits={} misses={} total={} hit_rate={:.1}%",
        hits,
        misses,
        hits + misses,
        if hits + misses > 0 { hits as f64 / (hits + misses) as f64 * 100.0 } else { 0.0 }
    );

    ScanResult {
        records,
        errors: Arc::try_unwrap(errors)
            .unwrap_or_else(|arc| Mutex::new(arc.lock().unwrap().clone()))
            .into_inner()
            .unwrap(),
        cache_hits: hits,
        cache_misses: misses,
    }
}
