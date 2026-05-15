use std::path::PathBuf;
use crate::models::MediaType;
use walkdir::WalkDir;

pub struct FoundFile {
    pub path: PathBuf,
    pub media_type: MediaType,
    pub size: u64,
    pub mtime: u64,
}

pub fn walk_folders(folders: &[String]) -> Vec<FoundFile> {
    let mut files = Vec::new();
    for folder in folders {
        for entry in WalkDir::new(folder)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext = path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            if let Some(media_type) = MediaType::from_extension(ext) {
                let meta = match std::fs::metadata(path) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let mtime = meta.modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                files.push(FoundFile {
                    path: path.to_path_buf(),
                    media_type,
                    size: meta.len(),
                    mtime,
                });
            }
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn finds_images_and_videos() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("photo.jpg"), b"fake").unwrap();
        fs::write(dir.path().join("clip.mp4"), b"fake").unwrap();
        fs::write(dir.path().join("notes.txt"), b"fake").unwrap();

        let found = walk_folders(&[dir.path().to_string_lossy().to_string()]);
        assert_eq!(found.len(), 2);
        let names: Vec<_> = found.iter()
            .map(|f| f.path.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert!(names.contains(&"photo.jpg".to_string()));
        assert!(names.contains(&"clip.mp4".to_string()));
    }

    #[test]
    fn ignores_non_media() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("doc.pdf"), b"fake").unwrap();
        let found = walk_folders(&[dir.path().to_string_lossy().to_string()]);
        assert_eq!(found.len(), 0);
    }
}
