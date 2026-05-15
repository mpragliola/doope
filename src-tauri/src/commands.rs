use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

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
        }
    }
}

#[tauri::command]
pub async fn scan(
    app: tauri::AppHandle,
    options: ScanOptions,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.cancel.store(false, Ordering::Relaxed);
    let cache = Arc::clone(&state.cache);
    let cancel = Arc::clone(&state.cancel);
    let app_clone = app.clone();
    let options_for_phase1 = options.clone();

    let result = tokio::task::spawn_blocking(move || {
        run_phase1(&options_for_phase1, cache, cancel, move |evt| {
            let _ = app_clone.emit("progress", &evt);
        })
    })
    .await
    .map_err(|e| e.to_string())?;

    let _ = app.emit("progress", &ProgressEvent {
        current: 0,
        total: 0,
        path: String::new(),
        phase: Phase::Grouping,
    });

    // Store raw records and scan mode for post-scan re-grouping
    *state.records.lock().unwrap() = result.records.clone();
    *state.last_mode.lock().unwrap() = options.mode.clone();

    let groups = {
        let records = result.records.clone();
        let opts = options.clone();
        tokio::task::spawn_blocking(move || {
            find_duplicates(&records, &opts.mode, opts.phash_threshold)
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
    threshold: u32,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let records = state.records.lock().unwrap().clone();
    let mode = state.last_mode.lock().unwrap().clone();
    let groups = tokio::task::spawn_blocking(move || {
        find_duplicates(&records, &mode, threshold)
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

#[tauri::command]
pub async fn auto_mark_group(
    group_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let groups = state.groups.lock().unwrap();
    let priorities = state.folder_priorities.lock().unwrap();

    let group = groups
        .iter()
        .find(|g| g.id == group_id)
        .ok_or_else(|| format!("group {} not found", group_id))?;

    let keeper = group.files.iter().min_by_key(|f| {
        priorities
            .iter()
            .position(|p| f.path.starts_with(p.as_str()))
            .unwrap_or(usize::MAX)
    });

    let keeper_path = keeper.map(|f| f.path.as_str()).unwrap_or("");
    let marked: Vec<String> = group
        .files
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

    let mut deleted = Vec::new();
    let mut errors = Vec::new();

    for path in &paths_to_delete {
        match std::fs::remove_file(path) {
            Ok(_) => deleted.push(path.clone()),
            Err(e) => errors.push(format!("{}: {}", path, e)),
        }
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
