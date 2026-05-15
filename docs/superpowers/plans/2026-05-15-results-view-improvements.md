# Results View Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the results view with an adaptive image comparison panel, post-scan re-grouping, group survivor badges, identical-vs-similar distinction, and last-copy inline warnings.

**Architecture:** Backend gains `max_distance` on `DuplicateGroup`, stores raw `FileRecord`s in `AppState` for re-grouping without re-scanning, and exposes two new IPC commands (`regroup`, `get_folder_priorities`). Frontend replaces the fixed-thumbnail file list with a full-height adaptive flex-row comparison panel, adds a controls bar for threshold + re-group + priority, and enriches the group sidebar with live survivor counts.

**Tech Stack:** Rust / Tauri IPC, vanilla TypeScript, CSS flexbox

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src-tauri/src/models.rs` | Modify | Add `max_distance: Option<u32>` to `DuplicateGroup` |
| `src-tauri/src/scanner/grouper.rs` | Modify | Compute and populate `max_distance` in perceptual groups |
| `src-tauri/src/commands.rs` | Modify | Add `records`/`last_mode` to `AppState`; store after phase 1; add `regroup` and `get_folder_priorities` |
| `src-tauri/src/lib.rs` | Modify | Register new commands |
| `src/types.ts` | Modify | Add `max_distance?: number` to `DuplicateGroup` |
| `src/api.ts` | Modify | Add `regroup()` and `getFolderPriorities()` wrappers |
| `src/scan-state.ts` | Create | Shared module holding last scan's `phash_threshold` |
| `src/views/scan-config.ts` | Modify | Save threshold to scan-state before navigating |
| `src/views/results.ts` | Modify | Controls bar, survivor badges, comparison panel, lightbox, last-copy warning |

---

## Task 1: Add `max_distance` to `DuplicateGroup` model

**Files:**
- Modify: `src-tauri/src/models.rs`

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)]` block in `models.rs`:

```rust
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test duplicate_group_has_max_distance_field 2>&1 | tail -20
```

Expected: compile error — `max_distance` is an unknown field.

- [ ] **Step 3: Add `max_distance` to `DuplicateGroup`**

In `src-tauri/src/models.rs`, update the struct:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateGroup {
    pub id: String,
    pub files: Vec<FileInfo>,
    pub duplicate_type: DuplicateType,
    pub wasted_bytes: u64,
    pub max_distance: Option<u32>,
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd src-tauri && cargo test duplicate_group_has_max_distance_field 2>&1 | tail -10
```

Expected: `test models::tests::duplicate_group_has_max_distance_field ... ok`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/models.rs
git commit -m "feat(models): add max_distance to DuplicateGroup"
```

---

## Task 2: Compute `max_distance` in grouper

**Files:**
- Modify: `src-tauri/src/scanner/grouper.rs`

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)]` block in `grouper.rs`:

```rust
#[test]
fn perceptual_group_max_distance_computed() {
    // h1=0, h2=1-bit-from-h1, h3=2-bits-from-h1, all within threshold=8
    let h1 = "0000000000000000";
    let h2 = "0000000000000001"; // distance 1 from h1
    let h3 = "0000000000000003"; // distance 2 from h1, distance 1 from h2
    let records = vec![
        FileRecord {
            path: "/a.jpg".to_string(), size: 100, mtime: 0,
            exact_hash: None, phash: Some(h1.to_string()),
            media_type: crate::models::MediaType::Image,
        },
        FileRecord {
            path: "/b.jpg".to_string(), size: 100, mtime: 0,
            exact_hash: None, phash: Some(h2.to_string()),
            media_type: crate::models::MediaType::Image,
        },
        FileRecord {
            path: "/c.jpg".to_string(), size: 100, mtime: 0,
            exact_hash: None, phash: Some(h3.to_string()),
            media_type: crate::models::MediaType::Image,
        },
    ];
    let groups = find_duplicates(&records, &ScanMode::Content, 8);
    assert_eq!(groups.len(), 1);
    // max pairwise distance: h1↔h3 = 2
    assert_eq!(groups[0].max_distance, Some(2));
}

#[test]
fn exact_group_has_no_max_distance() {
    let records = vec![
        rec("/a/img1.jpg", 1000, "hash_abc", None),
        rec("/b/img2.jpg", 1000, "hash_abc", None),
    ];
    let groups = find_duplicates(&records, &ScanMode::Content, 8);
    assert_eq!(groups[0].max_distance, None);
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd src-tauri && cargo test perceptual_group_max_distance_computed exact_group_has_no_max_distance 2>&1 | tail -20
```

Expected: compile errors — `make_group` and `DuplicateGroup` don't have the new field/param yet.

- [ ] **Step 3: Update `make_group` to accept `max_distance`**

Replace the `make_group` function:

```rust
fn make_group(members: Vec<&FileRecord>, dup_type: DuplicateType, max_distance: Option<u32>) -> DuplicateGroup {
    let max_size = members.iter().map(|r| r.size).max().unwrap_or(0);
    let wasted_bytes = members.iter().map(|r| r.size).sum::<u64>().saturating_sub(max_size);
    DuplicateGroup {
        id: Uuid::new_v4().to_string(),
        files: members
            .into_iter()
            .map(|r| FileInfo {
                path: r.path.clone(),
                size: r.size,
                media_type: r.media_type.clone(),
            })
            .collect(),
        duplicate_type: dup_type,
        wasted_bytes,
        max_distance,
    }
}
```

- [ ] **Step 4: Update callers of `make_group` to pass `None`**

In `group_by_filename`:
```rust
.map(|members| make_group(members, DuplicateType::Filename, None))
```

In `group_by_exact`:
```rust
.map(|members| make_group(members, DuplicateType::Exact, None))
```

- [ ] **Step 5: Add `compute_max_distance` helper and update `group_by_phash`**

Add the helper function before `group_by_phash`:

```rust
fn compute_max_distance(cluster: &[&FileRecord]) -> u32 {
    let mut max = 0u32;
    for i in 0..cluster.len() {
        for j in (i + 1)..cluster.len() {
            let hi = cluster[i].phash.as_deref().unwrap();
            let hj = cluster[j].phash.as_deref().unwrap();
            let d = if hi.contains(';') || hj.contains(';') {
                hamming_distance_multi(hi, hj)
            } else {
                hamming_distance(hi, hj)
            };
            if let Some(d) = d {
                if d > max {
                    max = d;
                }
            }
        }
    }
    max
}
```

Update `group_by_phash` — replace the cluster push at the end of the outer loop:

```rust
        if cluster.len() >= 2 {
            let max_dist = compute_max_distance(&cluster);
            groups.push(make_group(cluster, DuplicateType::Perceptual, Some(max_dist)));
        }
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd src-tauri && cargo test 2>&1 | tail -20
```

Expected: all tests pass, including the two new ones.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/scanner/grouper.rs
git commit -m "feat(grouper): compute max_distance for perceptual groups"
```

---

## Task 3: Extend `AppState` and add `regroup` / `get_folder_priorities` commands

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Add imports**

At the top of `commands.rs`, add `FileRecord` and `ScanMode` to the existing models import:

```rust
use crate::models::{DuplicateGroup, FileRecord, Phase, ProgressEvent, ScanMode, ScanOptions};
```

- [ ] **Step 2: Add `records` and `last_mode` to `AppState`**

Replace the `AppState` struct and `new()` impl:

```rust
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
```

- [ ] **Step 3: Store records and mode after phase 1 in `scan` command**

In the `scan` command, replace the grouping block (after the phase1 `result` is obtained) with:

```rust
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
```

- [ ] **Step 4: Add `regroup` command**

Append after the `cancel_scan` command:

```rust
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
```

- [ ] **Step 5: Add `get_folder_priorities` command**

Append after the `set_folder_priorities` command:

```rust
#[tauri::command]
pub async fn get_folder_priorities(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    Ok(state.folder_priorities.lock().unwrap().clone())
}
```

- [ ] **Step 6: Verify it compiles**

```bash
cd src-tauri && cargo build 2>&1 | tail -20
```

Expected: `Finished` with no errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(commands): store records for regroup; add regroup and get_folder_priorities"
```

---

## Task 4: Register new commands and run full test suite

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Register new commands**

Replace the `invoke_handler` block in `lib.rs`:

```rust
        .invoke_handler(tauri::generate_handler![
            commands::scan,
            commands::cancel_scan,
            commands::regroup,
            commands::get_duplicate_groups,
            commands::get_folder_priorities,
            commands::set_folder_priorities,
            commands::auto_mark_group,
            commands::delete_marked,
            commands::clear_cache,
            commands::check_ffmpeg,
        ])
```

- [ ] **Step 2: Run full test suite**

```bash
cd src-tauri && cargo test 2>&1 | tail -30
```

Expected: all tests pass (models, grouper, hasher, cache tests).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(lib): register regroup and get_folder_priorities commands"
```

---

## Task 5: Update TypeScript types and API wrappers

**Files:**
- Modify: `src/types.ts`
- Modify: `src/api.ts`

- [ ] **Step 1: Add `max_distance` to `DuplicateGroup` in types.ts**

Replace the `DuplicateGroup` interface:

```typescript
export interface DuplicateGroup {
  id: string;
  files: FileInfo[];
  duplicate_type: DuplicateType;
  wasted_bytes: number;
  max_distance?: number;
}
```

- [ ] **Step 2: Add `regroup` and `getFolderPriorities` to api.ts**

Add two entries to the `api` object (after `getDuplicateGroups`):

```typescript
  regroup: (threshold: number) =>
    invoke<void>('regroup', { threshold }),

  getFolderPriorities: () =>
    invoke<string[]>('get_folder_priorities'),
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd e:/dev/doope && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/api.ts
git commit -m "feat(types,api): add max_distance field and regroup/getFolderPriorities API"
```

---

## Task 6: Shared scan-state module + save threshold from scan-config

**Files:**
- Create: `src/scan-state.ts`
- Modify: `src/views/scan-config.ts`

- [ ] **Step 1: Create `src/scan-state.ts`**

```typescript
export let lastPhashThreshold = 8;
export function setLastPhashThreshold(v: number) { lastPhashThreshold = v; }
```

- [ ] **Step 2: Update `startScan` in scan-config.ts to save the threshold**

Add the import at the top of `scan-config.ts`:

```typescript
import { setLastPhashThreshold } from '../scan-state';
```

Inside `startScan()`, add one line before `navigate('progress')`:

```typescript
  setLastPhashThreshold(threshold);
  navigate('progress');
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd e:/dev/doope && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/scan-state.ts src/views/scan-config.ts
git commit -m "feat(scan-state): persist last phash threshold for results view"
```

---

## Task 7: Controls bar in results view (threshold + re-group + priority panel)

**Files:**
- Modify: `src/views/results.ts`

- [ ] **Step 1: Add module-level state and import**

At the top of `results.ts`, replace the existing imports and module vars:

```typescript
import { convertFileSrc } from '@tauri-apps/api/core';
import { api } from '../api';
import { navigate, showToast } from '../main';
import { lastPhashThreshold } from '../scan-state';
import type { DuplicateGroup, FileInfo } from '../types';

let groups: DuplicateGroup[] = [];
let marked = new Set<string>();
let selectedGroupId: string | null = null;
let currentThreshold = 8;
let resultsPriorities: string[] = [];
```

- [ ] **Step 2: Add controls bar HTML to `renderResults` template**

Replace `renderResults` with the version that includes the controls bar between the `.toolbar` div and the two-panel split:

```typescript
export function renderResults(el: HTMLElement) {
  el.innerHTML = `
    <div class="toolbar">
      <h1>Results</h1>
      <button class="ghost" id="btn-back">← New Scan</button>
      <span id="lbl-summary" style="font-size:13px;color:#aaa"></span>
    </div>
    <div id="controls-bar" style="display:flex;align-items:center;gap:10px;padding:8px 16px;background:#161616;border-bottom:1px solid #2a2a2a;flex-shrink:0">
      <span style="font-size:12px;color:#888">Threshold:</span>
      <input type="range" id="results-threshold" min="0" max="20" value="8" style="width:110px;padding:0">
      <span id="results-threshold-lbl" style="font-size:12px;min-width:18px;color:#e2e2e2">8</span>
      <button class="ghost" id="btn-regroup" style="font-size:12px;padding:5px 10px">Re-group</button>
      <button class="ghost" id="btn-toggle-priority" style="font-size:12px;padding:5px 10px;margin-left:auto">Priority ▾</button>
    </div>
    <div id="priority-panel" style="display:none;padding:8px 16px;background:#131313;border-bottom:1px solid #2a2a2a;flex-shrink:0">
      <div style="font-size:11px;color:#666;margin-bottom:6px">Drag to reorder — affects Auto-mark</div>
      <ul id="results-priority-list" style="list-style:none;display:flex;flex-direction:column;gap:4px"></ul>
    </div>
    <div style="display:flex;flex:1;overflow:hidden">
      <div style="width:280px;display:flex;flex-direction:column;border-right:1px solid #2a2a2a">
        <div style="padding:10px 12px;font-size:11px;color:#666;border-bottom:1px solid #1e1e1e">DUPLICATE GROUPS</div>
        <ul id="group-list" class="scroll-list" style="list-style:none"></ul>
      </div>
      <div id="group-detail" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
        <div style="flex:1;display:flex;align-items:center;justify-content:center;color:#555;font-size:14px">
          Select a group to inspect
        </div>
      </div>
    </div>
    <div style="padding:12px 16px;background:#1a1a1a;border-top:1px solid #2a2a2a;display:flex;align-items:center;gap:12px;flex-shrink:0">
      <span id="lbl-space" style="flex:1;font-size:13px;color:#aaa"></span>
      <button class="danger" id="btn-delete" disabled>Delete Marked</button>
    </div>
  `;

  el.querySelector('#btn-back')!.addEventListener('click', () => {
    groups = []; marked.clear(); selectedGroupId = null;
    navigate('scan-config');
  });
  el.querySelector('#btn-delete')!.addEventListener('click', confirmDelete);
  wireControlsBar();

  window.addEventListener('scan-complete', loadResults);
}
```

- [ ] **Step 3: Add `reapplyGroupSelection` stub (full impl in Task 8) and `wireControlsBar`**

Add after `renderResults` — the stub is needed here because `wireControlsBar` calls it; Task 8 replaces it:

```typescript
function reapplyGroupSelection() {
  // Implemented in Task 8
}
```

Add `wireControlsBar` after the stub:

```typescript
function wireControlsBar() {
  const slider = document.getElementById('results-threshold') as HTMLInputElement;
  const lbl = document.getElementById('results-threshold-lbl')!;
  slider.addEventListener('input', () => {
    currentThreshold = parseInt(slider.value);
    lbl.textContent = slider.value;
  });

  document.getElementById('btn-regroup')!.addEventListener('click', async () => {
    try {
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
    }
  });

  const toggleBtn = document.getElementById('btn-toggle-priority')!;
  const panel = document.getElementById('priority-panel')!;
  toggleBtn.addEventListener('click', () => {
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    toggleBtn.textContent = open ? 'Priority ▾' : 'Priority ▴';
  });
}
```

- [ ] **Step 4: Update `loadResults` to initialize threshold and priorities**

Replace `loadResults`:

```typescript
export async function loadResults() {
  groups = await api.getDuplicateGroups();
  marked.clear();
  selectedGroupId = null;

  // Sync threshold slider to last scan's setting
  currentThreshold = lastPhashThreshold;
  const slider = document.getElementById('results-threshold') as HTMLInputElement;
  const lbl = document.getElementById('results-threshold-lbl')!;
  if (slider) {
    slider.value = String(currentThreshold);
    lbl.textContent = String(currentThreshold);
  }

  // Load folder priorities
  try {
    resultsPriorities = await api.getFolderPriorities();
  } catch {
    resultsPriorities = [];
  }
  renderResultsPriorityList();

  renderGroupList();
  updateBottomBar();
}
```

- [ ] **Step 5: Add `renderResultsPriorityList` function**

Add after `loadResults`:

```typescript
function renderResultsPriorityList() {
  const ul = document.getElementById('results-priority-list');
  if (!ul) return;
  ul.innerHTML = resultsPriorities.map((f, i) => `
    <li draggable="true" data-idx="${i}"
        style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:#222;border-radius:4px;font-size:11px;cursor:grab">
      <span style="color:#666;margin-right:4px">${i + 1}.</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis" title="${f}">${f}</span>
    </li>
  `).join('');

  let dragSrc = -1;
  ul.querySelectorAll('li').forEach(li => {
    li.addEventListener('dragstart', () => { dragSrc = parseInt((li as HTMLElement).dataset.idx!); });
    li.addEventListener('dragover', e => { e.preventDefault(); });
    li.addEventListener('drop', () => {
      const dest = parseInt((li as HTMLElement).dataset.idx!);
      if (dragSrc !== dest) {
        const [item] = resultsPriorities.splice(dragSrc, 1);
        resultsPriorities.splice(dest, 0, item);
        api.setFolderPriorities(resultsPriorities).catch(() => {});
        renderResultsPriorityList();
      }
    });
  });
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd e:/dev/doope && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/views/results.ts
git commit -m "feat(results): add controls bar with threshold slider, re-group button, and priority panel"
```

---

## Task 8: Group sidebar — survivor badges and extended type badges

**Files:**
- Modify: `src/views/results.ts`

- [ ] **Step 1: Replace the `reapplyGroupSelection` stub (added in Task 7) with the full implementation**

Replace the stub body:

```typescript
function reapplyGroupSelection() {
  document.querySelectorAll('#group-list li[data-id]').forEach(li => {
    (li as HTMLElement).style.removeProperty('background');
  });
  if (selectedGroupId) {
    const li = document.querySelector(`#group-list li[data-id="${selectedGroupId}"]`) as HTMLElement | null;
    if (li) li.style.background = '#1e2a3a';
  }
}
```

- [ ] **Step 2: Replace `renderGroupList` with survivor-aware version**

Replace the entire `renderGroupList` function:

```typescript
function renderGroupList() {
  const ul = document.getElementById('group-list')!;
  const summary = document.getElementById('lbl-summary')!;

  summary.textContent = groups.length === 0
    ? 'No duplicates found'
    : `${groups.length} group${groups.length !== 1 ? 's' : ''} found`;

  ul.innerHTML = groups.map(g => {
    const wastedMb = (g.wasted_bytes / 1_048_576).toFixed(1);

    // Extended badge: ≈ = perceptual-identical (dist 0), ~ = perceptual-similar, = exact, F filename
    let badge: string;
    let badgeColor: string;
    if (g.duplicate_type === 'exact') {
      badge = '='; badgeColor = '#3b82f6';
    } else if (g.duplicate_type === 'perceptual') {
      if (g.max_distance === 0) {
        badge = '≈'; badgeColor = '#22c55e';
      } else {
        badge = '~'; badgeColor = '#a855f7';
      }
    } else {
      badge = 'F'; badgeColor = '#f59e0b';
    }

    const survivors = g.files.filter(f => !marked.has(f.path)).length;
    const markedCount = g.files.length - survivors;
    const noSurvivors = survivors === 0;
    const borderStyle = noSurvivors ? 'border-left:3px solid #ef4444' : 'border-left:3px solid transparent';
    const distLabel = g.duplicate_type === 'perceptual' && g.max_distance !== undefined
      ? `<span style="font-size:10px;color:#555;margin-left:4px">d=${g.max_distance}</span>`
      : '';

    const survivorLine = markedCount > 0
      ? `<div style="font-size:10px;color:${noSurvivors ? '#ef4444' : '#888'};margin-top:2px">
           ${markedCount} marked → ${survivors} survive${noSurvivors ? ' ⚠' : ''}
         </div>`
      : '';

    return `
      <li data-id="${g.id}" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid #1e1e1e;display:flex;flex-direction:column;gap:2px;${borderStyle}">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="background:${badgeColor};color:#fff;font-size:10px;border-radius:3px;padding:1px 5px">${badge}</span>
          ${distLabel}
          <span style="font-size:13px;font-weight:500">${g.files.length} files</span>
          <span style="font-size:11px;color:#666;margin-left:auto">${wastedMb} MB</span>
        </div>
        <div style="font-size:11px;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${shortPath(g.files[0]?.path ?? '')}
        </div>
        ${survivorLine}
      </li>
    `;
  }).join('');

  ul.querySelectorAll('li[data-id]').forEach(li => {
    li.addEventListener('click', () => {
      selectedGroupId = (li as HTMLElement).dataset.id!;
      reapplyGroupSelection();
      const group = groups.find(g => g.id === selectedGroupId);
      if (group) renderGroupDetail(group);
    });
  });

  reapplyGroupSelection();
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd e:/dev/doope && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/views/results.ts
git commit -m "feat(results): survivor badges and extended type badges in group sidebar"
```

---

## Task 9: Adaptive comparison panel

**Files:**
- Modify: `src/views/results.ts`

- [ ] **Step 1: Update `renderGroupDetail` to use flex-row container**

Replace the `renderGroupDetail` function:

```typescript
function renderGroupDetail(group: DuplicateGroup) {
  const el = document.getElementById('group-detail')!;

  let headerLabel = '';
  if (group.duplicate_type === 'perceptual') {
    headerLabel = group.max_distance === 0
      ? 'Perceptual identical (distance: 0)'
      : `Perceptual similar (distance: ${group.max_distance ?? '?'})`;
  } else if (group.duplicate_type === 'exact') {
    headerLabel = 'Exact duplicates';
  } else {
    headerLabel = 'Filename match';
  }

  el.innerHTML = `
    <div style="padding:10px 14px;border-bottom:1px solid #1e1e1e;display:flex;gap:8px;align-items:center;flex-shrink:0">
      <div style="flex:1;overflow:hidden">
        <span style="font-size:13px;font-weight:500">${group.files.length} files</span>
        <span style="font-size:11px;color:#666;margin-left:8px">${headerLabel}</span>
      </div>
      <button class="ghost" data-action="auto-mark" style="font-size:12px;padding:5px 10px">Auto-mark</button>
      <button class="ghost" data-action="keep-all" style="font-size:12px;padding:5px 10px">Keep all</button>
      <button class="ghost" data-action="delete-all" style="font-size:12px;padding:5px 10px;color:#fca5a5">Mark all delete</button>
    </div>
    <div id="file-grid" style="flex:1;display:flex;flex-direction:row;overflow-x:auto;gap:3px;padding:4px;background:#0d0d0d;min-height:0"></div>
  `;

  el.querySelector('[data-action=auto-mark]')!.addEventListener('click', () => autoMark(group));
  el.querySelector('[data-action=keep-all]')!.addEventListener('click', () => {
    group.files.forEach(f => marked.delete(f.path));
    renderComparisonPanel(group);
    renderGroupList();
    updateBottomBar();
  });
  el.querySelector('[data-action=delete-all]')!.addEventListener('click', () => {
    group.files.forEach(f => marked.add(f.path));
    renderComparisonPanel(group);
    renderGroupList();
    updateBottomBar();
  });

  renderComparisonPanel(group);
}
```

- [ ] **Step 2: Add `renderComparisonPanel` (replaces `renderFileGrid`)**

Delete the old `renderFileGrid` function entirely and add:

```typescript
function renderComparisonPanel(group: DuplicateGroup) {
  const grid = document.getElementById('file-grid')!;

  grid.innerHTML = group.files.map(f => {
    const isMarked = marked.has(f.path);
    const isImage = f.media_type === 'image';
    const sizeMb = (f.size / 1_048_576).toFixed(2);
    const borderColor = isMarked ? '#7f1d1d' : '#1a3a28';
    const stripBg = isMarked ? '#2d1515' : '#0f1f18';

    const imageArea = isImage
      ? `<div style="flex:1;position:relative;min-height:0;overflow:hidden;background:#080808">
           <img
             src="${convertFileSrc(f.path)}"
             data-action="lightbox"
             style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;cursor:zoom-in"
             onerror="this.style.opacity='0.2'"
           >
         </div>`
      : `<div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#444;font-size:12px">VIDEO</div>`;

    return `
      <div data-path="${escapeAttr(f.path)}"
           style="flex:1;min-width:180px;display:flex;flex-direction:column;border:2px solid ${borderColor};border-radius:6px;overflow:hidden">
        ${imageArea}
        <div style="height:44px;min-height:44px;display:flex;align-items:center;gap:6px;padding:0 8px;background:${stripBg};flex-shrink:0">
          <div style="flex:1;overflow:hidden;min-width:0">
            <div style="font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                 title="${escapeAttr(f.path)}">${filename(f.path)}</div>
            <div style="font-size:10px;color:#888">${sizeMb} MB</div>
          </div>
          <button class="${isMarked ? 'ghost' : 'primary'}" data-action="keep"
                  style="font-size:10px;padding:3px 8px;flex-shrink:0">Keep</button>
          <button class="${isMarked ? 'danger' : 'ghost'}" data-action="delete"
                  style="font-size:10px;padding:3px 8px;flex-shrink:0">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('[data-path]').forEach(cell => {
    const path = (cell as HTMLElement).dataset.path!;
    const file = group.files.find(f => f.path === path)!;

    cell.querySelector('[data-action=lightbox]')?.addEventListener('click', () => {
      openLightbox(file, group);
    });

    cell.querySelector('[data-action=keep]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      marked.delete(path);
      renderComparisonPanel(group);
      renderGroupList();
      updateBottomBar();
    });

    cell.querySelector('[data-action=delete]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      const survivors = group.files.filter(f => f.path !== path && !marked.has(f.path)).length;
      if (survivors === 0) {
        showLastCopyWarning(cell as HTMLElement, path, group);
      } else {
        marked.add(path);
        renderComparisonPanel(group);
        renderGroupList();
        updateBottomBar();
      }
    });
  });
}
```

- [ ] **Step 3: Update `autoMark` to call `renderComparisonPanel` and `renderGroupList`**

Replace the `autoMark` function:

```typescript
async function autoMark(group: DuplicateGroup) {
  try {
    const toMark = await api.autoMarkGroup(group.id);
    toMark.forEach(p => marked.add(p));
    renderComparisonPanel(group);
    renderGroupList();
    updateBottomBar();
  } catch (e) {
    showToast(String(e));
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd e:/dev/doope && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (note: `openLightbox` and `showLastCopyWarning` are referenced but not yet defined — add stubs if needed to pass compilation):

```typescript
function openLightbox(_f: FileInfo, _group: DuplicateGroup) { /* Task 10 */ }
function showLastCopyWarning(_cell: HTMLElement, _path: string, _group: DuplicateGroup) { /* Task 11 */ }
```

- [ ] **Step 5: Commit**

```bash
git add src/views/results.ts
git commit -m "feat(results): adaptive flex-row comparison panel with full-height images"
```

---

## Task 10: Lightbox

**Files:**
- Modify: `src/views/results.ts`

- [ ] **Step 1: Replace the `openLightbox` stub with the full implementation**

Replace `function openLightbox(_f: FileInfo, _group: DuplicateGroup) { /* Task 10 */ }` with:

```typescript
function openLightbox(f: FileInfo, group: DuplicateGroup) {
  const imageFiles = group.files.filter(fi => fi.media_type === 'image');
  let currentIdx = imageFiles.findIndex(fi => fi.path === f.path);

  const overlay = document.createElement('div');
  overlay.id = 'lightbox-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.92)',
    'display:flex;flex-direction:column;align-items:center;justify-content:center',
  ].join(';');

  function renderLightboxContent() {
    const fi = imageFiles[currentIdx];
    overlay.innerHTML = `
      <div style="position:absolute;top:12px;right:12px;display:flex;gap:8px">
        <span style="font-size:12px;color:#888;align-self:center">${currentIdx + 1} / ${imageFiles.length}</span>
        <button id="lb-close" class="ghost" style="padding:5px 12px;font-size:13px">✕ Close</button>
      </div>
      <div style="position:absolute;bottom:16px;font-size:12px;color:#888;max-width:80%;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
           title="${escapeAttr(fi.path)}">${fi.path}</div>
      <button id="lb-prev" class="ghost"
              style="position:absolute;left:12px;top:50%;transform:translateY(-50%);padding:10px 14px;font-size:18px${currentIdx === 0 ? ';opacity:0.2;cursor:default' : ''}">‹</button>
      <img src="${convertFileSrc(fi.path)}"
           style="max-width:calc(100vw - 120px);max-height:calc(100vh - 80px);object-fit:contain;border-radius:4px">
      <button id="lb-next" class="ghost"
              style="position:absolute;right:12px;top:50%;transform:translateY(-50%);padding:10px 14px;font-size:18px${currentIdx === imageFiles.length - 1 ? ';opacity:0.2;cursor:default' : ''}">›</button>
    `;

    overlay.querySelector('#lb-close')!.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#lb-prev')!.addEventListener('click', () => {
      if (currentIdx > 0) { currentIdx--; renderLightboxContent(); }
    });
    overlay.querySelector('#lb-next')!.addEventListener('click', () => {
      if (currentIdx < imageFiles.length - 1) { currentIdx++; renderLightboxContent(); }
    });
  }

  renderLightboxContent();
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
    if (e.key === 'ArrowLeft' && currentIdx > 0) { currentIdx--; renderLightboxContent(); }
    if (e.key === 'ArrowRight' && currentIdx < imageFiles.length - 1) { currentIdx++; renderLightboxContent(); }
  };
  document.addEventListener('keydown', onKey);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd e:/dev/doope && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/results.ts
git commit -m "feat(results): lightbox with prev/next navigation and keyboard support"
```

---

## Task 11: Last-copy inline warning

**Files:**
- Modify: `src/views/results.ts`

- [ ] **Step 1: Replace the `showLastCopyWarning` stub with full implementation**

Replace `function showLastCopyWarning(_cell: HTMLElement, _path: string, _group: DuplicateGroup) { /* Task 11 */ }` with:

```typescript
function showLastCopyWarning(cell: HTMLElement, path: string, group: DuplicateGroup) {
  // Remove any existing warning in this group's panel
  document.querySelectorAll('.last-copy-warning').forEach(w => w.remove());

  const strip = cell.querySelector<HTMLElement>('[data-action=delete]')!.parentElement!;
  const warning = document.createElement('div');
  warning.className = 'last-copy-warning';
  warning.style.cssText = [
    'position:absolute;bottom:44px;left:0;right:0',
    'background:#7f1d1d;color:#fca5a5;font-size:11px',
    'padding:6px 10px;display:flex;align-items:center;gap:8px;z-index:10',
  ].join(';');
  warning.innerHTML = `
    <span style="flex:1">Last copy — mark anyway?</span>
    <button class="danger" data-action="confirm-delete" style="font-size:10px;padding:3px 8px">Confirm</button>
    <button class="ghost" data-action="cancel-delete" style="font-size:10px;padding:3px 8px">Cancel</button>
  `;

  // The cell needs position:relative for the warning overlay to work
  cell.style.position = 'relative';
  cell.appendChild(warning);

  warning.querySelector('[data-action=confirm-delete]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    warning.remove();
    marked.add(path);
    renderComparisonPanel(group);
    renderGroupList();
    updateBottomBar();
  });

  warning.querySelector('[data-action=cancel-delete]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    warning.remove();
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd e:/dev/doope && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/results.ts
git commit -m "feat(results): inline last-copy warning before marking final survivor"
```

---

## Task 12: Build and smoke-test the full app

- [ ] **Step 1: Run full cargo test**

```bash
cd src-tauri && cargo test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 2: Build the Tauri app**

```bash
cd e:/dev/doope && npm run tauri dev 2>&1 &
```

- [ ] **Step 3: Manual smoke test checklist**

With a folder of duplicate images:
1. Configure and start a scan
2. Open results view — controls bar visible, threshold slider matches scan setting
3. Select a group — images fill the full panel height side-by-side
4. Click an image — lightbox opens; ← → arrow keys and buttons navigate; Escape closes
5. Mark one file for deletion — group list sidebar shows "1 marked → N-1 survive"; border color on cell turns red
6. Try to mark the last remaining file — "Last copy" warning banner appears; Cancel cancels, Confirm marks
7. Move threshold slider and click Re-group — groups update; marked state resets
8. Expand Priority panel — drag to reorder; auto-mark on a group respects new order
9. Verify `≈` badge on perceptual groups where all files have identical hashes; `~` where distance > 0
