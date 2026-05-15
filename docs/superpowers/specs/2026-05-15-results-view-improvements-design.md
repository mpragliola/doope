# Results View Improvements — Design Spec

**Date:** 2026-05-15  
**Status:** Approved

## Overview

Six improvements to the duplicate results experience: adaptive image comparison panel, enriched group sidebar with survivor status, post-scan re-grouping with adjustable threshold, folder priority editable in results, identical vs similar distinction, and inline last-copy safety warnings.

---

## 1. Adaptive Comparison Panel

### Problem
Thumbnails at 80×60px are too small to reliably compare images. The number of files per group varies, so a fixed size doesn't work.

### Design
The right-hand group detail panel becomes an image-first comparison view.

**Layout:**
- Images laid out in a single horizontal row using `display: flex`
- Each cell uses `flex: 1; height: 100%` — fills all available panel space equally
- `object-fit: contain` preserves full image without cropping
- 2 files → each ~50% width; 3 files → ~33%; etc.
- For groups with 5+ files the row scrolls horizontally (no further size reduction)

**Per-image cell:**
- Image fills the cell
- Bottom strip (44px, always visible): filename, size, Keep/Delete buttons
- Colored border: green = keep, red = marked for deletion, neutral = unmarked
- Clicking the image (outside the bottom strip) opens a fullscreen lightbox for that file

**Lightbox:**
- Full-screen overlay showing the selected image at maximum available size (`object-fit: contain`)
- Click outside or press Escape to close
- Previous/Next buttons to navigate within the group

---

## 2. Group Sidebar Enhancements

### Problem
No visibility into which groups have pending deletions or how many files would survive.

### Design
Each group list item gains:
- Survivor count line: `N files · K marked → M survive` in small colored text below the existing info
- If M = 0: red left border on the list item as a danger indicator
- Extended duplicate type badges:
  - `=` Exact (byte-for-byte identical via BLAKE3)
  - `≈` Perceptual-identical (dHash, `max_distance = 0`)
  - `~` Perceptual-similar (dHash, `max_distance > 0`)
  - `F` Filename match

The survivor count updates live as the user marks/unmarks files.

**Backend requirement:** `DuplicateGroup` gains `max_distance: Option<u32>` — the maximum pairwise hamming distance within a perceptual group (None for Exact/Filename groups).

---

## 3. Post-Scan Re-grouping

### Problem
Threshold is only adjustable before scanning. Re-scanning to try a different threshold is slow since all hashes are already computed.

### Design

**Controls bar** (new `div` inserted between the existing `.toolbar` header strip and the two-panel split, always visible):
- Threshold slider (0–20) with live numeric label — initialized from the last scan's `phash_threshold`
- "Re-group" button — re-runs grouping on stored records with the new threshold, no re-scan
- "Priority ▾" toggle button that expands/collapses a drag-reorder folder priority list inline below the controls bar

**New IPC command:** `regroup(threshold: u32)`
- Reads `state.records` (new AppState field, see below)
- Calls `find_duplicates(&records, &last_mode, threshold)`
- Overwrites `state.groups`
- Returns `Result<(), String>`

**AppState changes:**
- Add `records: Arc<Mutex<Vec<FileRecord>>>` — populated after phase 1 completes, before grouping
- Add `last_mode: Arc<Mutex<ScanMode>>` — stores the `ScanMode` variant from scan options; used by `regroup` to preserve the original mode (changing mode post-scan is a non-goal)
- After `scan` command completes phase 1, store the records in AppState before grouping

**New IPC command:** `get_folder_priorities() -> Vec<String>`
- Returns current `state.folder_priorities`
- Allows the results view to read the priority order on load

---

## 4. Folder Priority in Results

### Problem
Folder priority can only be set before a scan. Auto-mark relies on this priority, so correcting it requires going back to scan-config.

### Design
The results toolbar collapsible section contains the same drag-reorder priority list as scan-config. Changes call the existing `set_folder_priorities` IPC command immediately. Auto-mark continues to use the in-memory priority from AppState, so re-running auto-mark on a group picks up the new order without re-scanning.

No new backend code needed beyond `get_folder_priorities` above.

---

## 5. Identical vs Similar Distinction

### Problem
All perceptual matches look the same even though distance=0 means pixel-level identical (just different file metadata) while distance>0 means visually similar but not identical.

### Design
`max_distance: Option<u32>` on `DuplicateGroup` (see Section 2) drives two changes:
- Badge: `≈` for distance=0, `~` for distance>0
- Group detail header shows the distance: "Perceptual match (distance: 3)" or "Perceptual identical (distance: 0)"

**Backend:** `group_by_phash` in `grouper.rs` computes `max_distance` after clustering by iterating all pairs within each formed cluster.

---

## 6. Last-Copy Inline Safety Warning

### Problem
Marking the last surviving file in a group silently creates a state where deletion would destroy all copies. The existing backend guard only triggers at delete-time.

### Design
**Frontend only.** Before adding a path to `marked`:
1. Check if `group.files.filter(f => !marked.has(f.path)).length === 1` (i.e., this would be the last unmarked file)
2. If so: show an inline confirmation inside the cell — border flashes red, a banner renders: "Last copy — mark anyway?" with Confirm / Cancel buttons
3. Confirm → mark it (cell turns red, group item in sidebar gets red left border)
4. Cancel → no change

The existing backend guard in `delete_marked` stays as final safety net.

---

## Affected Files

### Backend (`src-tauri/src/`)
| File | Change |
|------|--------|
| `models.rs` | Add `max_distance: Option<u32>` to `DuplicateGroup` |
| `commands.rs` | Add `records` + `last_mode` to `AppState`; store records after phase 1; add `regroup` and `get_folder_priorities` commands |
| `scanner/grouper.rs` | Track and return `max_distance` in `group_by_phash` |

### Frontend (`src/`)
| File | Change |
|------|--------|
| `types.ts` | Add `max_distance?: number` to `DuplicateGroup`; add `ScanMode` type |
| `api.ts` | Add `regroup(threshold)` and `getFolderPriorities()` wrappers |
| `views/results.ts` | Full rework of detail panel (comparison layout, lightbox); sidebar survivor badges; results toolbar with threshold slider + Re-group + priority list; last-copy inline warning |

---

## Non-Goals
- Re-scanning (threshold change triggers re-group only, not re-hash)
- Changing scan mode (filename/content/both) post-scan
- Video playback in the comparison panel (VIDEO placeholder kept)
