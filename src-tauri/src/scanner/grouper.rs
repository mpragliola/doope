use std::collections::HashMap;
use uuid::Uuid;

use crate::models::{DuplicateGroup, DuplicateType, FileInfo, FileRecord, ScanMode};
use crate::scanner::hasher::{hamming_distance, hamming_distance_multi};

pub fn find_duplicates(
    records: &[FileRecord],
    mode: &ScanMode,
    threshold: u32,
) -> Vec<DuplicateGroup> {
    let mut groups: Vec<DuplicateGroup> = Vec::new();

    match mode {
        ScanMode::Filename => {
            groups.extend(group_by_filename(records));
        }
        ScanMode::Content => {
            groups.extend(group_by_exact(records));
            groups.extend(group_by_phash(records, threshold));
        }
        ScanMode::Both => {
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
            groups.extend(group_by_exact(&remaining));
            groups.extend(group_by_phash(&remaining, threshold));
        }
    }

    groups.retain(|g| g.files.len() >= 2);
    groups
}

fn group_by_filename(records: &[FileRecord]) -> Vec<DuplicateGroup> {
    let mut map: HashMap<(String, u64), Vec<&FileRecord>> = HashMap::new();
    for r in records {
        let name = std::path::Path::new(&r.path)
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default()
            .to_string();
        map.entry((name, r.size)).or_default().push(r);
    }
    map.into_values()
        .filter(|v| v.len() >= 2)
        .map(|members| make_group(members, DuplicateType::Filename))
        .collect()
}

fn group_by_exact(records: &[FileRecord]) -> Vec<DuplicateGroup> {
    let mut map: HashMap<&str, Vec<&FileRecord>> = HashMap::new();
    for r in records {
        if let Some(h) = &r.exact_hash {
            map.entry(h.as_str()).or_default().push(r);
        }
    }
    map.into_values()
        .filter(|v| v.len() >= 2)
        .map(|members| make_group(members, DuplicateType::Exact))
        .collect()
}

fn group_by_phash(records: &[FileRecord], threshold: u32) -> Vec<DuplicateGroup> {
    let with_hash: Vec<&FileRecord> = records.iter().filter(|r| r.phash.is_some()).collect();
    let n = with_hash.len();
    let mut assigned = vec![false; n];
    let mut groups: Vec<DuplicateGroup> = Vec::new();

    for i in 0..n {
        if assigned[i] { continue; }
        let mut cluster: Vec<&FileRecord> = vec![with_hash[i]];
        assigned[i] = true;
        let hi = with_hash[i].phash.as_deref().unwrap();
        for j in (i + 1)..n {
            if assigned[j] { continue; }
            let hj = with_hash[j].phash.as_deref().unwrap();
            let dist = if hi.contains(';') || hj.contains(';') {
                hamming_distance_multi(hi, hj)
            } else {
                hamming_distance(hi, hj)
            };
            if dist.map_or(false, |d| d <= threshold) {
                cluster.push(with_hash[j]);
                assigned[j] = true;
            }
        }
        if cluster.len() >= 2 {
            groups.push(make_group(cluster, DuplicateType::Perceptual));
        }
    }
    groups
}

fn make_group(members: Vec<&FileRecord>, dup_type: DuplicateType) -> DuplicateGroup {
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::MediaType;

    fn rec(path: &str, size: u64, exact: &str, phash: Option<&str>) -> FileRecord {
        FileRecord {
            path: path.to_string(),
            size,
            mtime: 0,
            exact_hash: Some(exact.to_string()),
            phash: phash.map(|s| s.to_string()),
            media_type: MediaType::Image,
        }
    }

    #[test]
    fn exact_duplicates_grouped() {
        let records = vec![
            rec("/a/img1.jpg", 1000, "hash_abc", None),
            rec("/b/img2.jpg", 1000, "hash_abc", None),
            rec("/c/img3.jpg", 2000, "hash_xyz", None),
        ];
        let groups = find_duplicates(&records, &ScanMode::Content, 8);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].files.len(), 2);
        assert_eq!(groups[0].duplicate_type, DuplicateType::Exact);
    }

    #[test]
    fn filename_duplicates_grouped() {
        let records = vec![
            rec("/a/photo.jpg", 500, "h1", None),
            rec("/b/photo.jpg", 500, "h2", None),
        ];
        let groups = find_duplicates(&records, &ScanMode::Filename, 8);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].duplicate_type, DuplicateType::Filename);
    }

    #[test]
    fn no_group_for_unique_files() {
        let records = vec![
            rec("/a/img1.jpg", 1000, "hash_a", None),
            rec("/b/img2.jpg", 2000, "hash_b", None),
        ];
        let groups = find_duplicates(&records, &ScanMode::Content, 8);
        assert_eq!(groups.len(), 0);
    }

    #[test]
    fn wasted_bytes_correct() {
        let records = vec![
            rec("/a/img1.jpg", 1000, "same", None),
            rec("/b/img2.jpg", 1000, "same", None),
            rec("/c/img3.jpg", 1000, "same", None),
        ];
        let groups = find_duplicates(&records, &ScanMode::Content, 8);
        assert_eq!(groups[0].wasted_bytes, 2000);
    }
}
