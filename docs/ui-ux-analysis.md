# Doope — UI/UX Critical Analysis

## App Overview

**Doope** is a desktop duplicate image/video finder built with Tauri (Rust + TypeScript). It has three views in a linear flow:

1. **Scan Config** — Choose folders, scan mode, video strategy, perceptual threshold, folder priority
2. **Progress** — Live progress bar through hashing → grouping phases
3. **Results** — Two-pane: group list sidebar + group detail with file cards, keep/delete marking, batch delete

The backend is solid: exact hash, perceptual hash (pHash), filename matching, video frame extraction, SQLite cache, cancellable scan. The frontend is functional but raw — almost entirely inline styles, system-ui font, no animations, no visual polish.

---

## Critical Findings

### 1. Information Architecture — Scan Config is Confusing

**The folder/priority split is the biggest UX problem in the app.**

There are two lists side by side in the left column:
- "Folders" — add/remove folders
- "Folder Priority (drag to reorder)" — reorder the same folders

A new user will not understand why the same folders appear twice, or what "priority" means in this context. The priority concept (which folder's copy to *keep* during auto-mark) is only meaningful in the results view, not during scan configuration. This violates the principle of progressive disclosure — the priority UI belongs where it's used: in the results view, near the "Auto-mark by priority" button.

**Other scan config issues:**
- "Clear Cache" is in the toolbar — most users don't know what the cache is and don't need this option on screen at all times. Move to a settings/overflow menu.
- Scan mode options are verbose: "Both (Filename + Content)" reads like developer terminology. Users think in terms of "thorough" vs "fast".
- The perceptual threshold slider (0–20) has minimal labeling. "Exact only (0)" and "Very similar (20)" are helpful but a user dragging to 15 has no idea what level of visual similarity that corresponds to. A visual example or a category label at key values would help.
- The "Video Strategy" select is not clearly connected to the perceptual threshold — they're separate controls that interact (strategy determines what threshold applies to). No visual grouping.
- When scan mode is "filename", the `content-options` section is hidden (`display:none`) but its vertical space is reclaimed, causing the layout to shift. This is jarring.

---

### 2. Progress View — Functional but Uninspiring

The progress view works correctly but misses opportunities:

- **No phase differentiation**: "Hashing…" and "Grouping duplicates…" look identical except for the label text. A visual phase indicator (step 1/2) would help users understand where they are and how much time is left.
- **No speed/ETA**: Even a simple "X files/sec" or elapsed time would reduce anxiety on large collections.
- **The current path (11px, #666)** is nearly invisible — too small and too dim to be useful. Either make it legible or remove it entirely.
- **Cancel navigates to Results** (partially populated or empty), which is confusing. It should navigate back to Scan Config, or show a "scan was cancelled" state in results.
- The progress bar at 100% during "grouping" is misleading — the user may think it's done when it's not.

---

### 3. Results View — Key Workflow Gaps

#### The badge system is cryptic
Single-letter badges: `=` (exact), `~` (perceptual), `F` (filename). There is no legend anywhere in the UI. A user who hasn't read documentation will not know what these mean. This is a significant discoverability failure for what is probably the most-looked-at piece of data in the results view.

#### No global auto-mark
"Auto-mark by priority" only applies to the currently selected group. If there are 200 groups, the user has to:
1. Click a group
2. Click "Auto-mark by priority"
3. Click next group
4. Repeat 200 times

There's no "Auto-mark all groups" button. For most use cases (user has clear folder preferences), this would be the single most used operation. Its absence forces exhausting manual work.

#### No sorting or filtering of groups
The group list is shown in an arbitrary order (insertion order from the grouper). Users dealing with large photo libraries need to:
- Sort by wasted bytes (largest first — highest ROI per click)
- Filter by duplicate type (review exact duplicates separately from perceptual ones)
- Filter by media type (images vs videos)

Without sorting, a user with 500 groups stares at an unordered list and has to manually scan for the biggest opportunities.

#### Tiny thumbnails
Thumbnails are 80×60px. On a desktop app with potentially a wide content area, this is inadequate for visually similar (perceptual) duplicates where the user needs to evaluate subtle differences — e.g., a slightly cropped version vs original, same photo at different resolution. There's no way to see a larger preview. Side-by-side comparison is the core UI pattern for any duplicate *image* finder; its absence is a significant gap.

#### Destructive confirmation uses browser native dialog
`window.confirm()` renders a native OS dialog that looks jarring in a desktop app context. It breaks the visual continuity and doesn't match the dark theme. Use an inline confirmation modal or a "confirm" state on the button itself.

#### The "survivors" safety check is silent until delete
The bottom bar shows "⚠ One group has no survivors — adjust marking" but only when the user has already marked everything in a group. A per-group warning (highlighting the group in the sidebar list) would catch this earlier.

#### No bulk operations across groups
No "mark all exact duplicates" or "auto-mark all groups". No multi-select in the group list. Every action is per-group, per-file.

#### No way to open a file or its containing folder
Users often want to preview an image in their default viewer, or navigate to its folder in Explorer. There are no context menu or "reveal in explorer" options.

---

### 4. Visual Design — Cosmetic but Real Problems

#### Typography
`system-ui, -apple-system, sans-serif` — the most generic possible choice. On Windows this renders as Segoe UI, which is fine for system UIs but gives Doope zero identity. A desktop productivity tool with a focused purpose deserves a font that reflects that character.

#### Color and visual hierarchy
The current palette:
- Background: `#111`
- Toolbar: `#1a1a1a`
- Cards: `#181818` / `#1e1e1e`
- Borders: `#2a2a2a` / `#252525`

These tones are so similar that the eye can barely distinguish sections. There's no strong visual hierarchy — the toolbar, sidebar, and content area all have nearly the same luminance. Compare:
- Toolbar `#1a1a1a` vs body `#111` → 4% brightness difference
- Card bg `#181818` vs page bg `#111` → barely perceptible

The result is a UI that looks flat and undefined. Real dark UIs use deliberate elevation: darker backgrounds, lighter cards, visible hierarchy through shadow or border contrast.

#### The primary action (Start Scan) is undersized and disabled by default
The "Start Scan" button at the bottom of the right panel is `width:100%` and a reasonable size, but it's visually buried at the bottom. Its disabled state with the message "Select folders to scan" is good, but the enabled state ("Start Scan (2 folders)") doesn't feel like a primary call to action — it looks like any other button.

#### Inline styles everywhere
Nearly all layout is done with inline `style` attributes. This creates maintenance burden and inconsistency:
- Padding values: `16px`, `24px`, `12px`, `10px`, `6px` — no system
- Colors: hardcoded hex scattered throughout (`#666`, `#555`, `#aaa`, `#222`, etc.)
- Font sizes: `10px`, `11px`, `12px`, `13px`, `14px`, `15px` — no scale

This isn't a visual problem for users, but it means every future change requires hunting through strings of inline styles.

#### No micro-interactions or animations
View transitions are instant (`display:none` → `display:flex`). There's no feedback animation when adding a folder, no smooth transition from scan config to progress, no entrance animation for the results. For a Tauri desktop app targeting power users, this is acceptable — but a simple fade or slide would dramatically elevate the feel.

---

### 5. Common Patterns for Duplicate Finders — Missing

Based on well-established patterns from apps like dupeGuru, Duplicate Cleaner, Gemini (Mac), and Czkawka:

| Pattern | Industry Standard | Doope |
|---------|------------------|-------|
| Side-by-side comparison | Yes, core feature | Missing |
| Large image preview on hover/click | Yes | Missing |
| Sort groups by wasted space | Yes | Missing |
| Filter by duplicate type | Yes | Missing |
| Bulk auto-select all duplicates | Yes | Missing |
| Reveal in Finder/Explorer | Yes | Missing |
| Legend/key for duplicate types | Yes | Missing |
| Statistics summary (total groups, total waste) | Yes | Partial (group count in toolbar, no total) |
| Undo last delete | Some | Missing |
| Per-group diff view | Some (image apps) | Missing |

---

## Priority Fix List

### Critical (workflow-breaking)
1. **Add "Auto-mark all groups" button** — most important missing feature
2. **Fix cancel → should go back to scan config**, not results
3. **Add duplicate type legend** in results sidebar header
4. **Sort groups by wasted bytes descending** by default

### High (significant friction)
5. **Move folder priority into results view**, next to "Auto-mark by priority"
6. **Add larger image preview** (click thumbnail to expand, or show 200px+ cards)
7. **Replace window.confirm with inline confirmation**
8. **Add total wasted space summary** in results toolbar
9. **Sort/filter controls** for the group list (by type, by size)
10. **Fix cancel during progress** to show partial results or return to config cleanly

### Medium (polish and clarity)
11. **Relabel scan mode options** to be user-facing: "Thorough (name + content)", "Fast (name only)", "Content only"
12. **Add threshold visual labels**: "Strict", "Balanced (default)", "Loose" at key slider values
13. **Per-group survivor warning** indicator in the group list (not just bottom bar)
14. **Improve badge labels**: Replace `=`/`~`/`F` with "Exact" / "Similar" / "Name"
15. **Replace system-ui font** with a characterful choice
16. **Elevate visual hierarchy** — darken body bg or lighten cards to create clear separation
17. **Progress phase indicator** (step 1 of 2) instead of just text label change

### Low (nice to have)
18. Reveal in Explorer / Open with default app context menu
19. Keyboard shortcuts (Delete to mark, Enter to confirm, arrow keys for groups)
20. Undo last delete (show success toast with undo action)
21. Auto-advance to next group after marking all files in current group
22. View transition animation between scan config and progress
