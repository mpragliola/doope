use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use rayon::prelude::*;
use tauri::Emitter;

use crate::cache::Cache;
use crate::models::{DuplicateGroup, FileRecord, Phase, ProgressEvent, ScanMode, ScanOptions};
use crate::scanner::{grouper::find_duplicates, run_phase1};

pub struct AppState {
    pub cache: Arc<Mutex<Cache>>,
    pub groups: Arc<Mutex<Vec<DuplicateGroup>>>,
    pub records: Arc<Mutex<Vec<FileRecord>>>,
    pub last_mode: Arc<Mutex<ScanMode>>,
    pub folder_priorities: Arc<Mutex<Vec<String>>>,
    pub cancel: Arc<AtomicBool>,
    pub scanning: Arc<AtomicBool>,
}

impl AppState {
    pub fn new() -> Self {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
        let db_path = std::path::PathBuf::from(appdata).join("doope").join("cache.db");
        let cache = Cache::open(&db_path).expect("failed to open cache");
        Self {
            cache: Arc::new(Mutex::new(cache)),
            groups: Arc::new(Mutex::new(vec![])),
            records: Arc::new(Mutex::new(vec![])),
            last_mode: Arc::new(Mutex::new(ScanMode::Both)),
            folder_priorities: Arc::new(Mutex::new(vec![])),
            cancel: Arc::new(AtomicBool::new(false)),
            scanning: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[tauri::command]
pub async fn scan(
    app: tauri::AppHandle,
    options: ScanOptions,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // Reject if a scan is already in progress (cancel first, then retry).
    if state.scanning.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Err("scan already in progress".to_string());
    }

    state.cancel.store(false, Ordering::Relaxed);
    let cache = Arc::clone(&state.cache);
    let cancel = Arc::clone(&state.cancel);
    let scanning = Arc::clone(&state.scanning);
    let app_clone = app.clone();
    let options_for_phase1 = options.clone();

    let result = tokio::task::spawn_blocking(move || {
        let r = run_phase1(&options_for_phase1, cache, cancel, move |evt| {
            let _ = app_clone.emit("progress", &evt);
        });
        scanning.store(false, Ordering::Release);
        r
    })
    .await
    .map_err(|e| {
        state.scanning.store(false, Ordering::Release);
        e.to_string()
    })?;

    let _ = app.emit("progress", &ProgressEvent {
        current: 0,
        total: 0,
        path: String::new(),
        phase: Phase::Grouping,
        cached: None,
    });

    println!(
        "[scan] {} files scanned — {} cache hits, {} misses ({:.1}% hit rate)",
        result.cache_hits + result.cache_misses,
        result.cache_hits,
        result.cache_misses,
        if result.cache_hits + result.cache_misses > 0 {
            result.cache_hits as f64 / (result.cache_hits + result.cache_misses) as f64 * 100.0
        } else { 0.0 }
    );

    // Store raw records and scan mode for post-scan re-grouping
    *state.records.lock().unwrap() = result.records.clone();
    *state.last_mode.lock().unwrap() = options.mode.clone();

    let groups = {
        let records = result.records.clone();
        let opts = options.clone();
        tokio::task::spawn_blocking(move || {
            find_duplicates(&records, &opts.mode, opts.phash_threshold, |_| {})
        })
        .await
        .map_err(|e| e.to_string())?
    };

    *state.groups.lock().unwrap() = groups;

    let _ = app.emit("progress", &ProgressEvent {
        current: 0,
        total: 0,
        path: String::new(),
        phase: Phase::Done,
        cached: None,
    });

    Ok(())
}

#[tauri::command]
pub async fn cancel_scan(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn regroup(
    app: tauri::AppHandle,
    threshold: u32,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let records = state.records.lock().unwrap().clone();
    let mode = state.last_mode.lock().unwrap().clone();
    let app_clone = app.clone();
    let groups = tokio::task::spawn_blocking(move || {
        find_duplicates(&records, &mode, threshold, |phase| {
            let _ = app_clone.emit("regroup-progress", phase);
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    *state.groups.lock().unwrap() = groups;
    Ok(())
}

#[tauri::command]
pub async fn get_duplicate_groups(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DuplicateGroup>, String> {
    Ok(state.groups.lock().unwrap().clone())
}

#[tauri::command]
pub async fn set_folder_priorities(
    priorities: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    *state.folder_priorities.lock().unwrap() = priorities;
    Ok(())
}

#[tauri::command]
pub async fn get_folder_priorities(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    Ok(state.folder_priorities.lock().unwrap().clone())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoMarkMode {
    Priority,
    Quality,
}

fn select_keeper<'a>(
    files: &'a [crate::models::FileInfo],
    priorities: &[String],
    mode: &AutoMarkMode,
) -> Option<&'a crate::models::FileInfo> {
    match mode {
        AutoMarkMode::Priority => files.iter().min_by_key(|f| {
            priorities
                .iter()
                .position(|p| f.path.starts_with(p.as_str()))
                .unwrap_or(usize::MAX)
        }),
        AutoMarkMode::Quality => files.iter().max_by_key(|f| {
            let area = image::image_dimensions(&f.path)
                .map(|(w, h)| w as u64 * h as u64)
                .unwrap_or(0);
            let prio_rank = priorities
                .iter()
                .position(|p| f.path.starts_with(p.as_str()))
                .unwrap_or(usize::MAX);
            (area, usize::MAX.saturating_sub(prio_rank))
        }),
    }
}

#[tauri::command]
pub async fn auto_mark_group(
    group_id: String,
    mode: AutoMarkMode,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let (files, priorities) = {
        let groups = state.groups.lock().unwrap();
        let priorities = state.folder_priorities.lock().unwrap();
        let group = groups
            .iter()
            .find(|g| g.id == group_id)
            .ok_or_else(|| format!("group {} not found", group_id))?;
        (group.files.clone(), priorities.clone())
    };

    let keeper_path = select_keeper(&files, &priorities, &mode)
        .map(|f| f.path.clone())
        .unwrap_or_default();

    let marked: Vec<String> = files
        .iter()
        .filter(|f| f.path != keeper_path)
        .map(|f| f.path.clone())
        .collect();

    Ok(marked)
}

#[tauri::command]
pub async fn delete_marked(
    paths_to_delete: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let groups = state.groups.lock().unwrap();
    let delete_set: std::collections::HashSet<&str> =
        paths_to_delete.iter().map(|s| s.as_str()).collect();

    for group in groups.iter() {
        let survivors = group
            .files
            .iter()
            .filter(|f| !delete_set.contains(f.path.as_str()))
            .count();
        if survivors == 0 {
            return Err(format!(
                "Deletion aborted: group would have no survivors (group id: {})",
                group.id
            ));
        }
    }
    drop(groups);

    let results: Vec<Result<String, String>> = paths_to_delete
        .par_iter()
        .map(|path| {
            std::fs::remove_file(path)
                .map(|_| path.clone())
                .map_err(|e| format!("{}: {}", path, e))
        })
        .collect();

    let mut deleted = Vec::new();
    let mut errors = Vec::new();
    for r in results {
        match r { Ok(p) => deleted.push(p), Err(e) => errors.push(e) }
    }

    {
        let mut groups = state.groups.lock().unwrap();
        let deleted_set: std::collections::HashSet<&str> =
            deleted.iter().map(|s| s.as_str()).collect();
        for group in groups.iter_mut() {
            group.files.retain(|f| !deleted_set.contains(f.path.as_str()));
        }
        groups.retain(|g| g.files.len() >= 2);
    }

    if !errors.is_empty() {
        return Err(errors.join("\n"));
    }
    Ok(deleted)
}

#[tauri::command]
pub async fn clear_cache(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state
        .cache
        .lock()
        .unwrap()
        .clear()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_ffmpeg() -> bool {
    crate::scanner::video::ffmpeg_available()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{DuplicateType, FileInfo, MediaType};

    fn make_group(files: Vec<(&str, u64)>) -> DuplicateGroup {
        DuplicateGroup {
            id: "test-group".to_string(),
            files: files
                .into_iter()
                .map(|(path, size)| FileInfo {
                    path: path.to_string(),
                    size,
                    media_type: MediaType::Image,
                    width: None,
                    height: None,
                })
                .collect(),
            duplicate_type: DuplicateType::Perceptual,
            wasted_bytes: 0,
            max_distance: Some(2),
        }
    }

    fn priority_keeper(group: &DuplicateGroup, priorities: &[String]) -> String {
        select_keeper(&group.files, priorities, &AutoMarkMode::Priority)
            .map(|f| f.path.clone())
            .unwrap_or_default()
    }

    fn quality_keeper(group: &DuplicateGroup, priorities: &[String]) -> String {
        select_keeper(&group.files, priorities, &AutoMarkMode::Quality)
            .map(|f| f.path.clone())
            .unwrap_or_default()
    }

    #[test]
    fn priority_mode_keeps_highest_priority_folder() {
        let group = make_group(vec![
            ("/low/a.jpg", 100),
            ("/high/b.jpg", 50),
        ]);
        let priorities = vec!["/high".to_string(), "/low".to_string()];
        let keeper = priority_keeper(&group, &priorities);
        assert_eq!(keeper, "/high/b.jpg");
    }

    #[test]
    fn priority_mode_no_priorities_keeps_first() {
        let group = make_group(vec![
            ("/a/x.jpg", 100),
            ("/b/y.jpg", 200),
        ]);
        let priorities: Vec<String> = vec![];
        let keeper = priority_keeper(&group, &priorities);
        assert_eq!(keeper, "/a/x.jpg");
    }

    #[test]
    fn quality_mode_unreadable_images_fall_back_to_priority() {
        // paths that don't exist → image_dimensions returns Err → area = 0 → priority decides
        let group = make_group(vec![
            ("/low/a.jpg", 500),
            ("/high/b.jpg", 100),
        ]);
        let priorities = vec!["/high".to_string(), "/low".to_string()];
        let keeper = quality_keeper(&group, &priorities);
        // both area=0, tie broken by priority → /high/b.jpg wins
        assert_eq!(keeper, "/high/b.jpg");
    }

    #[test]
    fn quality_mode_keeps_largest_image() {
        use image::{ImageBuffer, Rgb};

        // Create two real PNG files in a temp dir with different dimensions
        let dir = tempfile::tempdir().unwrap();

        // small: 10×10
        let small_path = dir.path().join("small.png");
        let small_img: ImageBuffer<Rgb<u8>, _> = ImageBuffer::new(10, 10);
        small_img.save(&small_path).unwrap();

        // large: 100×100
        let large_path = dir.path().join("large.png");
        let large_img: ImageBuffer<Rgb<u8>, _> = ImageBuffer::new(100, 100);
        large_img.save(&large_path).unwrap();

        let group = make_group(vec![
            (small_path.to_str().unwrap(), 50),
            (large_path.to_str().unwrap(), 200),
        ]);
        let priorities: Vec<String> = vec![];
        let keeper = quality_keeper(&group, &priorities);
        assert_eq!(keeper, large_path.to_str().unwrap());
    }
}
