# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Start Vite dev server + Tauri app (hot reload)
npm run build        # tsc + vite build (frontend only)
npm run tauri build  # Full production build (frontend + Rust)

# Rust (from src-tauri/)
cargo check          # Type-check without building
cargo build          # Debug build
cargo build --release
cargo test           # Run all Rust tests
cargo test <name>    # Run a single test by name
cargo clippy         # Lint
```

FFmpeg must be installed and available on PATH for video deduplication to work.

## Architecture

Doope is a Tauri 2 desktop app: Rust backend communicates with a vanilla TypeScript frontend via IPC commands and events.

### Frontend (`src/`)

Three-view SPA with no framework — pure DOM manipulation:
- `main.ts` — view router, bootstraps the app
- `api.ts` — typed wrappers around all `invoke()` / `listen()` Tauri calls
- `scan-state.ts` — persists scan config between sessions via `localStorage`
- `views/scan-config.ts` → `views/progress.ts` → `views/results.ts` (linear flow)

Progress updates are streamed from Rust via Tauri events (`scan-progress`, `scan-complete`), not polled.

### Backend (`src-tauri/src/`)

| File/Module | Role |
|---|---|
| `commands.rs` | 10 Tauri commands — the IPC surface (scan, regroup, delete, cache ops, etc.) |
| `models.rs` | Shared structs passed between frontend and backend |
| `scanner/walker.rs` | Parallel directory traversal via `jwalk` |
| `scanner/hasher.rs` | BLAKE3 (exact match) + dHash (perceptual, images) |
| `scanner/video.rs` | FFmpeg integration — extracts N frames in one invocation, hashes each |
| `scanner/grouper.rs` | Groups files into duplicate sets using the BK-tree |
| `scanner/bktree.rs` | BK-tree metric structure for O(n log n) nearest-neighbor perceptual search |
| `cache/` | SQLite (WAL mode) — caches `(path, mtime, size) → hashes` to skip unchanged files |

### Data Flow

```
User picks folders
  → Rust walker (parallel, jwalk)
  → Hasher (BLAKE3 + dHash/video frames), with SQLite cache lookup
  → Progress events → frontend progress view
  → Grouper (BK-tree, Hamming distance threshold)
  → Results returned to frontend
  → User marks / bulk-deletes duplicates
  → Cache updated with new hashes
```

### Scan Modes & Video Strategies

**Scan modes** (set by user): `filename`, `content`, `both`.

**Video dedup strategies**: `exact_only`, `first_frame`, `multi_frame` (default 8 frames). All frames for a file are extracted in a single FFmpeg invocation.

### Performance Notes

The backend is heavily optimized — batch SQLite writes (single transaction), `rayon` parallel hashing, `jwalk` parallel walk, and BK-tree grouping. Avoid introducing per-file DB writes or sequential loops over large file sets.

### IPC Contract

All Tauri commands are declared in `commands.rs` and registered in `lib.rs`. Frontend types in `src/types.ts` must stay in sync with `models.rs`. When adding a new command, update both files.
