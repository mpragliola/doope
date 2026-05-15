use anyhow::Result;
use image::{DynamicImage, imageops};
use std::path::Path;

/// BLAKE3 hash of the full file, returned as 64-char hex string.
pub fn blake3_hash(path: &Path) -> Result<String> {
    let data = std::fs::read(path)?;
    let hash = blake3::hash(&data);
    Ok(hash.to_hex().to_string())
}

/// dHash of an image: resize to 9x8 grayscale, compare adjacent pixels.
/// Returns a 16-char hex string representing a u64.
pub fn dhash_image(img: &DynamicImage) -> String {
    let small = img
        .resize_exact(9, 8, imageops::FilterType::Lanczos3)
        .to_luma8();
    let mut hash: u64 = 0;
    for y in 0..8u32 {
        for x in 0..8u32 {
            let left = small.get_pixel(x, y)[0];
            let right = small.get_pixel(x + 1, y)[0];
            if left > right {
                hash |= 1u64 << (y * 8 + x);
            }
        }
    }
    format!("{:016x}", hash)
}

/// Load image from disk and compute dHash.
pub fn dhash_path(path: &Path) -> Result<String> {
    let img = image::open(path)?;
    Ok(dhash_image(&img))
}

/// Hamming distance between two 16-char hex dHash strings.
pub fn hamming_distance(a: &str, b: &str) -> Option<u32> {
    let a_val = u64::from_str_radix(a, 16).ok()?;
    let b_val = u64::from_str_radix(b, 16).ok()?;
    Some((a_val ^ b_val).count_ones())
}

/// Hamming distance between two multi-frame hash strings (semicolon-separated).
/// Returns the minimum distance across all frame pairs.
pub fn hamming_distance_multi(a: &str, b: &str) -> Option<u32> {
    let a_frames: Vec<&str> = a.split(';').collect();
    let b_frames: Vec<&str> = b.split(';').collect();
    let mut min_dist = u32::MAX;
    for fa in &a_frames {
        for fb in &b_frames {
            if let Some(d) = hamming_distance(fa, fb) {
                if d < min_dist {
                    min_dist = d;
                }
            }
        }
    }
    if min_dist == u32::MAX { None } else { Some(min_dist) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, RgbImage};
    use tempfile::tempdir;

    fn solid_image(r: u8, g: u8, b: u8) -> DynamicImage {
        let mut img = RgbImage::new(100, 100);
        for pixel in img.pixels_mut() {
            *pixel = image::Rgb([r, g, b]);
        }
        DynamicImage::ImageRgb8(img)
    }

    fn striped_image() -> DynamicImage {
        let mut img = RgbImage::new(100, 100);
        for (x, _y, pixel) in img.enumerate_pixels_mut() {
            // Create alternating vertical stripes (black and white)
            let val = if (x / 10) % 2 == 0 { 0 } else { 255 };
            *pixel = image::Rgb([val, val, val]);
        }
        DynamicImage::ImageRgb8(img)
    }

    #[test]
    fn blake3_hash_deterministic() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("test.bin");
        std::fs::write(&file, b"hello world").unwrap();
        let h1 = blake3_hash(&file).unwrap();
        let h2 = blake3_hash(&file).unwrap();
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64);
    }

    #[test]
    fn dhash_identical_images_match() {
        let img = solid_image(128, 64, 32);
        let h1 = dhash_image(&img);
        let h2 = dhash_image(&img);
        assert_eq!(h1, h2);
        assert_eq!(hamming_distance(&h1, &h2).unwrap(), 0);
    }

    #[test]
    fn dhash_different_images_differ() {
        let h1 = dhash_image(&striped_image());
        let h2 = dhash_image(&solid_image(128, 128, 128));
        let dist = hamming_distance(&h1, &h2).unwrap();
        assert!(dist > 0);
    }

    #[test]
    fn hamming_multi_min_distance() {
        let a = "0000000000000000;ffffffffffffffff";
        let b = "0000000000000001";
        let dist = hamming_distance_multi(a, b).unwrap();
        assert_eq!(dist, 1);
    }
}
