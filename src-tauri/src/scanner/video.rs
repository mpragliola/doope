use anyhow::{bail, Result};
use image::DynamicImage;
use rayon::prelude::*;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Run a command to completion, killing it immediately if `cancel` is set.
fn run_cancellable(mut cmd: Command, cancel: &Arc<AtomicBool>) -> Result<std::process::Output> {
    let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            bail!("cancelled");
        }
        match child.try_wait()? {
            Some(status) => {
                let stdout = child.stdout.take()
                    .map(|mut r| { let mut b = Vec::new(); std::io::Read::read_to_end(&mut r, &mut b).ok(); b })
                    .unwrap_or_default();
                let stderr = child.stderr.take()
                    .map(|mut r| { let mut b = Vec::new(); std::io::Read::read_to_end(&mut r, &mut b).ok(); b })
                    .unwrap_or_default();
                return Ok(std::process::Output { status, stdout, stderr });
            }
            None => std::thread::sleep(std::time::Duration::from_millis(20)),
        }
    }
}

pub fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Extract a single frame from a video at `position` (0.0 = start, 1.0 = end).
pub fn extract_frame(video_path: &Path, position: f64, cancel: &Arc<AtomicBool>) -> Result<DynamicImage> {
    let duration = get_duration(video_path, cancel)?;
    let timestamp = (duration * position.clamp(0.0, 0.99)).max(0.0);

    let tmp = std::env::temp_dir().join(format!(
        "doope_frame_{}.png",
        uuid::Uuid::new_v4()
    ));

    let mut cmd = Command::new("ffmpeg");
    cmd.args([
        "-ss", &format!("{:.3}", timestamp),
        "-i", &video_path.to_string_lossy(),
        "-frames:v", "1",
        "-q:v", "2",
        "-y",
        &tmp.to_string_lossy(),
    ]);
    let status = run_cancellable(cmd, cancel)?.status;

    if !status.success() {
        bail!("ffmpeg failed to extract frame from {:?}", video_path);
    }

    let img = image::open(&tmp)?;
    let _ = std::fs::remove_file(&tmp);
    Ok(img)
}

/// Extract `count` frames distributed across the video in a single ffmpeg call.
/// Uses the `select` filter with `between(t,start,end)` windows. All frames are
/// written as numbered PNGs to a temp directory. Returns (tmp_dir, sorted frame paths).
fn extract_frames_batch(
    video_path: &Path,
    duration: f64,
    count: usize,
    cancel: &Arc<AtomicBool>,
) -> Result<(std::path::PathBuf, Vec<std::path::PathBuf>)> {
    let tmp_dir = std::env::temp_dir()
        .join(format!("doope_batch_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp_dir)?;

    // 0.5 s window per target timestamp — wide enough for typical frame rates.
    let select_expr = (0..count)
        .map(|i| {
            let ts = duration * (i as f64 + 0.5) / count as f64;
            let ts = ts.clamp(0.0, duration - 0.01);
            let end = (ts + 0.5).min(duration);
            format!("between(t,{:.3},{:.3})", ts, end)
        })
        .collect::<Vec<_>>()
        .join("+");

    let output_pattern = tmp_dir.join("frame_%04d.png");

    let mut cmd = Command::new("ffmpeg");
    cmd.args([
        "-i", &video_path.to_string_lossy(),
        "-vf", &format!("select='{}'", select_expr),
        "-vsync", "0",
        "-y",
        &output_pattern.to_string_lossy(),
    ]);
    let status = run_cancellable(cmd, cancel)?.status;

    if !status.success() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        bail!("ffmpeg batch frame extraction failed for {:?}", video_path);
    }

    let mut frame_files: Vec<std::path::PathBuf> = std::fs::read_dir(&tmp_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("png"))
        .collect();
    frame_files.sort();

    Ok((tmp_dir, frame_files))
}

pub fn video_phash(
    path: &Path,
    strategy: &crate::models::VideoStrategy,
    frame_count: usize,
    cancel: &Arc<AtomicBool>,
) -> Option<String> {
    use crate::models::VideoStrategy;
    use crate::scanner::hasher::dhash_image;

    match strategy {
        VideoStrategy::ExactOnly => None,

        VideoStrategy::FirstFrame => {
            extract_frame(path, 0.05, cancel)
                .ok()
                .map(|img| dhash_image(&img))
        }

        VideoStrategy::MultiFrame => {
            let count = frame_count.max(1);
            if count == 1 {
                return extract_frame(path, 0.5, cancel)
                    .ok()
                    .map(|img| dhash_image(&img));
            }

            let duration = get_duration(path, cancel).ok()?;
            let (tmp_dir, frame_files) =
                extract_frames_batch(path, duration, count, cancel).ok()?;

            // Parallel: each frame is an independent image decode + resize + hash.
            // par_iter on Vec preserves order, so hash positions stay aligned with frame order.
            let hashes: Vec<String> = frame_files
                .par_iter()
                .filter_map(|p| image::open(p).ok().map(|img| dhash_image(&img)))
                .collect();

            let _ = std::fs::remove_dir_all(&tmp_dir);

            if hashes.is_empty() { None } else { Some(hashes.join(";")) }
        }
    }
}

fn get_duration(path: &Path, cancel: &Arc<AtomicBool>) -> Result<f64> {
    let mut cmd = Command::new("ffprobe");
    cmd.args([
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        &path.to_string_lossy(),
    ]);
    let output = run_cancellable(cmd, cancel)?;
    let s = String::from_utf8_lossy(&output.stdout);
    let duration: f64 = s.trim().parse().unwrap_or(60.0);
    Ok(duration)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffmpeg_available_does_not_panic() {
        let _ = ffmpeg_available();
    }

    #[test]
    fn video_phash_exact_only_returns_none() {
        use crate::models::VideoStrategy;
        use std::sync::atomic::AtomicBool;
        let cancel = Arc::new(AtomicBool::new(false));
        let result = video_phash(Path::new("/nonexistent.mp4"), &VideoStrategy::ExactOnly, 4, &cancel);
        assert!(result.is_none());
    }
}
