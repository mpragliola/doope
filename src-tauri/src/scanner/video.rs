use anyhow::{bail, Result};
use image::DynamicImage;
use std::path::Path;
use std::process::Command;

pub fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Extract a single frame from a video at `position` (0.0 = start, 1.0 = end).
pub fn extract_frame(video_path: &Path, position: f64) -> Result<DynamicImage> {
    let duration = get_duration(video_path)?;
    let timestamp = (duration * position.clamp(0.0, 0.99)).max(0.0);

    let tmp = std::env::temp_dir().join(format!(
        "doope_frame_{}.png",
        uuid::Uuid::new_v4()
    ));

    let status = Command::new("ffmpeg")
        .args([
            "-ss", &format!("{:.3}", timestamp),
            "-i", &video_path.to_string_lossy(),
            "-frames:v", "1",
            "-q:v", "2",
            "-y",
            &tmp.to_string_lossy(),
        ])
        .output()?
        .status;

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

    let status = Command::new("ffmpeg")
        .args([
            "-i", &video_path.to_string_lossy(),
            "-vf", &format!("select='{}'", select_expr),
            "-vsync", "0",
            "-y",
            &output_pattern.to_string_lossy(),
        ])
        .output()?
        .status;

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
) -> Option<String> {
    use crate::models::VideoStrategy;
    use crate::scanner::hasher::dhash_image;

    match strategy {
        VideoStrategy::ExactOnly => None,

        VideoStrategy::FirstFrame => {
            extract_frame(path, 0.05)
                .ok()
                .map(|img| dhash_image(&img))
        }

        VideoStrategy::MultiFrame => {
            let count = frame_count.max(1);
            if count == 1 {
                return extract_frame(path, 0.5)
                    .ok()
                    .map(|img| dhash_image(&img));
            }

            let duration = get_duration(path).ok()?;
            let (tmp_dir, frame_files) =
                extract_frames_batch(path, duration, count).ok()?;

            let hashes: Vec<String> = frame_files
                .iter()
                .filter_map(|p| image::open(p).ok().map(|img| dhash_image(&img)))
                .collect();

            let _ = std::fs::remove_dir_all(&tmp_dir);

            if hashes.is_empty() { None } else { Some(hashes.join(";")) }
        }
    }
}

fn get_duration(path: &Path) -> Result<f64> {
    let output = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            &path.to_string_lossy(),
        ])
        .output()?;
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
        let result = video_phash(Path::new("/nonexistent.mp4"), &VideoStrategy::ExactOnly, 4);
        assert!(result.is_none());
    }
}
