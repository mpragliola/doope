# Regroup Progress Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit per-phase progress events from the `regroup` Tauri command and display inline status feedback in the results view controls bar.

**Architecture:** Add a `progress: impl Fn(&str)` callback to `find_duplicates` in `grouper.rs`, called before each sub-phase ("filename", "exact", "perceptual"). The `regroup` command in `commands.rs` emits these as `regroup-progress` Tauri events. The results view subscribes during the operation and shows inline status text next to the Re-group button.

**Tech Stack:** Rust (Tauri 2, rayon), TypeScript (vanilla DOM, `@tauri-apps/api`)

---

## File Map

| File | Change |
|---|---|
| `src-tauri/src/scanner/grouper.rs` | Add `progress` callback param to `find_duplicates`; update all internal calls; update tests |
| `src-tauri/src/commands.rs` | Add `AppHandle` to `regroup`, wire callback to emit `regroup-progress`; add `\|_\| {}` to scan's `find_duplicates` call |
| `src/api.ts` | Add `onRegroupProgress` event listener wrapper |
| `src/views/results.ts` | Add `#regroup-status` span to controls bar; rewrite Re-group click handler |

---

### Task 1: Add progress callback to `find_duplicates`

**Files:**
- Modify: `src-tauri/src/scanner/grouper.rs`

- [ ] **Step 1: Add a new test that captures callback phases**

Add this test inside the `#[cfg(test)]` block at the bottom of `src-tauri/src/scanner/grouper.rs` (after the existing `exact_group_has_no_max_distance` test):

```rust
#[test]
fn progress_callback_receives_phase_strings() {
    use std::sync::{Arc, Mutex};
    let records = vec![
        rec("/a/img1.jpg", 1000, "hash_abc", Some("0000000000000000")),
        rec("/b/img2.jpg", 1000, "hash_abc", Some("0000000000000001")),
    ];
    let phases: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
    let phases_clone = Arc::clone(&phases);
    find_duplicates(&records, &ScanMode::Both, 8, move |p| {
        phases_clone.lock().unwrap().push(p.to_string());
    });
    let called = phases.lock().unwrap();
    assert!(called.contains(&"filename".to_string()));
    assert!(called.contains(&"exact".to_string()));
    assert!(called.contains(&"perceptual".to_string()));
}
```

- [ ] **Step 2: Run the test to confirm it fails to compile**

```bash
cd src-tauri && cargo test progress_callback_receives_phase_strings 2>&1 | head -20
```

Expected: compile error — `find_duplicates` called with 4 args but takes 3.

- [ ] **Step 3: Update `find_duplicates` signature and body**

Replace the entire `find_duplicates` function in `src-tauri/src/scanner/grouper.rs`:

```rust
pub fn find_duplicates(
    records: &[FileRecord],
    mode: &ScanMode,
    threshold: u32,
    progress: impl Fn(&str) + Send + Sync,
) -> Vec<DuplicateGroup> {
    let mut groups: Vec<DuplicateGroup> = Vec::new();

    match mode {
        ScanMode::Filename => {
            progress("filename");
            groups.extend(group_by_filename(records));
        }
        ScanMode::Content => {
            progress("exact");
            groups.extend(group_by_exact(records));
            progress("perceptual");
            groups.extend(group_by_phash(records, threshold));
        }
        ScanMode::Both => {
            progress("filename");
            let filename_groups = group_by_filename(records);
            let filename_grouped_paths: std::collections::HashSet<String> = filename_groups
                .iter()
                .flat_map(|g| g.files.iter().map(|f| f.path.clone()))
                .collect();
            groups.extend(filename_groups);

            let remaining: Vec<FileRecord> = records
                .iter()
                .filter(|r| !filename_grouped_paths.contains(&r.path))
                .cloned()
                .collect();
            progress("exact");
            groups.extend(group_by_exact(&remaining));
            progress("perceptual");
            groups.extend(group_by_phash(&remaining, threshold));
        }
    }

    groups.retain(|g| g.files.len() >= 2);
    groups
}
```

- [ ] **Step 4: Fix the existing tests — add `|_| {}` to every `find_duplicates` call in the test module**

In `src-tauri/src/scanner/grouper.rs`, update each test call. There are 6 calls across 6 tests. Change every occurrence from:

```rust
find_duplicates(&records, &ScanMode::Content, 8)
```

to:

```rust
find_duplicates(&records, &ScanMode::Content, 8, |_| {})
```

The 6 call sites and their updated signatures:

- `exact_duplicates_grouped`: `find_duplicates(&records, &ScanMode::Content, 8, |_| {})`
- `filename_duplicates_grouped`: `find_duplicates(&records, &ScanMode::Filename, 8, |_| {})`
- `no_group_for_unique_files`: `find_duplicates(&records, &ScanMode::Content, 8, |_| {})`
- `wasted_bytes_correct`: `find_duplicates(&records, &ScanMode::Content, 8, |_| {})`
- `perceptual_group_max_distance_computed`: `find_duplicates(&records, &ScanMode::Content, 8, |_| {})`
- `exact_group_has_no_max_distance`: `find_duplicates(&records, &ScanMode::Content, 8, |_| {})`

- [ ] **Step 5: Run all grouper tests to confirm they pass**

```bash
cd src-tauri && cargo test --lib scanner::grouper 2>&1
```

Expected: 7 tests pass (6 existing + 1 new).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/scanner/grouper.rs
git commit -m "feat(grouper): add progress callback to find_duplicates"
```

---

### Task 2: Wire `regroup` command to emit progress events

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Update the `regroup` command**

Replace the entire `regroup` function (lines 121–134) in `src-tauri/src/commands.rs`:

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
        find_duplicates(&records, &mode, threshold, |phase| {
            let _ = app_clone.emit("regroup-progress", phase);
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    *state.groups.lock().unwrap() = groups;
    Ok(())
}
```

- [ ] **Step 2: Fix the `find_duplicates` call inside the `scan` command**

In `src-tauri/src/commands.rs`, find the `find_duplicates` call inside `scan` (currently around line 95). It looks like:

```rust
tokio::task::spawn_blocking(move || {
    find_duplicates(&records, &opts.mode, opts.phash_threshold)
})
```

Change it to:

```rust
tokio::task::spawn_blocking(move || {
    find_duplicates(&records, &opts.mode, opts.phash_threshold, |_| {})
})
```

- [ ] **Step 3: Verify the crate compiles cleanly**

```bash
cd src-tauri && cargo check 2>&1
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
cd src-tauri && cargo test 2>&1
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(commands): emit regroup-progress events from regroup command"
```

---

### Task 3: Add `onRegroupProgress` to the API module

**Files:**
- Modify: `src/api.ts`

- [ ] **Step 1: Add the listener method**

In `src/api.ts`, add `onRegroupProgress` after the existing `onProgress` method. The full updated file:

```typescript
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

  regroup: (threshold: number) =>
    invoke<void>('regroup', { threshold }),

  getFolderPriorities: () =>
    invoke<string[]>('get_folder_priorities'),

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

  onRegroupProgress: (cb: (phase: string) => void): Promise<UnlistenFn> =>
    listen<string>('regroup-progress', e => cb(e.payload)),
};
```

- [ ] **Step 2: Commit**

```bash
git add src/api.ts
git commit -m "feat(api): add onRegroupProgress event listener"
```

---

### Task 4: Add inline progress feedback to the results view

**Files:**
- Modify: `src/views/results.ts`

- [ ] **Step 1: Add `#regroup-status` span to the controls bar HTML**

In `src/views/results.ts`, find the controls bar button (around line 27):

```html
<button class="ghost" id="btn-regroup" style="font-size:12px;padding:5px 10px">Re-group <kbd style="font-size:10px;opacity:0.6">R</kbd></button>
```

Replace it with:

```html
<button class="ghost" id="btn-regroup" style="font-size:12px;padding:5px 10px">Re-group <kbd style="font-size:10px;opacity:0.6">R</kbd></button>
      <span id="regroup-status" style="font-size:12px;color:#666;display:none"></span>
```

- [ ] **Step 2: Replace the Re-group click handler in `wireControlsBar`**

In `src/views/results.ts`, find and replace the entire Re-group click handler block (currently lines 87–107):

```typescript
  const regroupBtn = document.getElementById('btn-regroup') as HTMLButtonElement;
  regroupBtn.addEventListener('click', async () => {
    if (regroupBtn.disabled) return;

    const status = document.getElementById('regroup-status') as HTMLElement;
    const originalLabel = regroupBtn.innerHTML;
    regroupBtn.disabled = true;
    regroupBtn.textContent = 'Re-grouping…';
    status.style.display = 'inline';

    const phaseLabels: Record<string, string> = {
      filename: 'filename…',
      exact: 'exact hash…',
      perceptual: 'perceptual…',
    };

    let unlisten: (() => void) | null = null;
    try {
      unlisten = await api.onRegroupProgress((phase) => {
        status.textContent = phaseLabels[phase] ?? phase;
      });
      await api.regroup(currentThreshold);
      const prevSelected = selectedGroupId;
      groups = await api.getDuplicateGroups();
      marked.clear();
      selectedGroupId = null;
      renderGroupList();
      updateBottomBar();
      if (prevSelected) {
        const g = groups.find(g => g.id === prevSelected);
        if (g) {
          selectedGroupId = g.id;
          reapplyGroupSelection();
          renderGroupDetail(g);
        }
      }
    } catch (e) {
      showToast(String(e));
    } finally {
      unlisten?.();
      regroupBtn.disabled = false;
      regroupBtn.innerHTML = originalLabel;
      status.style.display = 'none';
      status.textContent = '';
    }
  });
```

Note: the old handler used `document.getElementById('btn-regroup')!.addEventListener(...)`. Remove that line and the entire old handler block, replacing with the above.

- [ ] **Step 3: Build the frontend to check for TypeScript errors**

```bash
npm run build 2>&1
```

Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Start the app and manually verify**

```bash
npm run dev
```

Test sequence:
1. Run a scan to populate results
2. Adjust the threshold slider
3. Click Re-group — button should show "Re-grouping…" and the status span should cycle through "filename…", "exact hash…", "perceptual…"
4. After completion, button label should restore to `Re-group R` and status span should disappear
5. Press `R` keyboard shortcut — should trigger the same flow (and be ignored if already re-grouping)
6. Confirm group list re-renders correctly with the new threshold

- [ ] **Step 5: Commit**

```bash
git add src/views/results.ts
git commit -m "feat(results): show per-phase progress during regroup"
```
