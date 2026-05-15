use anyhow::{bail, Result};
use image::DynamicImage;
use std::path::Path;
use std::process::Command;

/// Returns true if ffmpeg is available on PATH.
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

/// Get video duration in seconds via ffprobe.
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

/// Compute dHash for a video using the given strategy.
/// Returns None if strategy is ExactOnly or ffmpeg is unavailable.
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
            let hashes: Vec<String> = (0..count)
                .filter_map(|i| {
                    let pos = (i as f64 + 0.5) / count as f64;
                    extract_frame(path, pos)
                        .ok()
                        .map(|img| dhash_image(&img))
                })
                .collect();
            if hashes.is_empty() {
                None
            } else {
                Some(hashes.join(";"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffmpeg_available_does_not_panic() {
        let _ = ffmpeg_available();
    }
}
