# Regroup Progress Feedback — Design

## Problem

`regroup` takes 3-4 seconds on large datasets. The frontend awaits the IPC call with no UI feedback — the Re-group button appears frozen for the duration.

## Solution

Emit Tauri `progress` events from the `regroup` command as it moves through sub-phases. The results view subscribes during the operation and shows inline status text in the controls bar.

---

## Rust

### `models.rs` — Phase enum

Add a `Regrouping` variant:

```rust
pub enum Phase {
    Walking,
    Hashing,
    Grouping,
    Regrouping,  // new
    Done,
}
```

### `scanner/grouper.rs` — find_duplicates signature

Add a progress callback parameter:

```rust
pub fn find_duplicates(
    records: &[FileRecord],
    mode: &ScanMode,
    threshold: u32,
    progress: impl Fn(Phase) + Send + Sync,
) -> Vec<DuplicateGroup>
```

The callback is called once before each sub-phase:
- Before filename grouping → `progress(Phase::Regrouping)` (signals start)
- Before exact hash grouping → `progress(Phase::Regrouping)`
- Before perceptual grouping → `progress(Phase::Regrouping)`

Each call carries a phase message via a separate mechanism — see below.

**Revised approach**: rather than a generic `Phase` callback, pass a `&str` message alongside:

```rust
pub fn find_duplicates(
    records: &[FileRecord],
    mode: &ScanMode,
    threshold: u32,
    progress: impl Fn(&str) + Send + Sync,
) -> Vec<DuplicateGroup>
```

Called with:
- `"filename"` before filename grouping
- `"exact"` before exact hash grouping  
- `"perceptual"` before perceptual grouping

### `commands.rs` — regroup command

Add `AppHandle` and wire up the callback:

```rust
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
        find_duplicates(&records, &mode, threshold, |phase_str| {
            let _ = app_clone.emit("regroup-progress", phase_str);
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    *state.groups.lock().unwrap() = groups;
    Ok(())
}
```

Uses a dedicated `regroup-progress` event (separate from `progress`) to avoid interfering with the scan event pipeline.

The existing `find_duplicates` call in `scan` (commands.rs) passes a no-op closure: `|_| {}`.

---

## Frontend

### `api.ts`

Add a typed wrapper for the new event:

```ts
onRegroupProgress(cb: (phase: string) => void): Promise<UnlistenFn>
```

### `results.ts` — Re-group button handler

```
click →
  disable button, set label "Re-grouping…"
  subscribe to regroup-progress events → update status span text
  try:
    await api.regroup(currentThreshold)
    unlisten
    fetch groups, re-render
  finally:
    re-enable button, restore label "Re-group"
    clear status span
```

### Controls bar HTML

Add a `<span id="regroup-status">` after the Re-group button. Hidden by default (`display:none`), shown during regroup with text like `"filename…"`, `"exact hash…"`, `"perceptual…"`. Styled as small muted text matching the existing controls bar aesthetic (`font-size:12px;color:#666`).

---

## Error handling

- If `regroup` throws, the `finally` block re-enables the button and clears the status. The existing `showToast` handles the error message.
- The `unlisten` call is safe to call multiple times; call it in both the success path and `finally`.

---

## What stays the same

- The `progress` event channel is untouched — scan progress is unaffected.
- `find_duplicates` test suite: all existing tests pass a no-op `|_| {}` closure.
- Results view re-render logic after regroup is unchanged.
