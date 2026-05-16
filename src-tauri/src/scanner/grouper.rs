use rayon::prelude::*;
use std::collections::HashMap;
use uuid::Uuid;

use crate::models::{DuplicateGroup, DuplicateType, FileInfo, FileRecord, ScanMode};
use crate::scanner::bktree::BkTree;
use crate::scanner::hasher::{hamming_distance, hamming_distance_multi};

pub fn find_duplicates(
    records: &[FileRecord],
    mode: &ScanMode,
    threshold: u32,
    progress: impl Fn(&str) + Send + Sync,
) -> Vec<DuplicateGroup> {
    let mut groups: Vec<DuplicateGroup> = Vec::new();

    match mode {
        ScanMode::Filename => {
            progress("filename");
            groups.extend(group_by_filename(records));
        }
        ScanMode::Content => {
            progress("exact");
            groups.extend(group_by_exact(records));
            progress("perceptual");
            groups.extend(group_by_phash(records, threshold));
        }
        ScanMode::Both => {
            progress("filename");
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
            progress("exact");
            groups.extend(group_by_exact(&remaining));
            progress("perceptual");
            groups.extend(group_by_phash(&remaining, threshold));
        }
    }

    groups.retain(|g| g.files.len() >= 2);
    groups
}

fn compute_max_distance(cluster: &[&FileRecord]) -> u32 {
    let n = cluster.len();
    (0..n)
        .flat_map(|i| (i + 1..n).map(move |j| (i, j)))
        .collect::<Vec<_>>()
        .par_iter()
        .filter_map(|&(i, j)| {
            let hi = cluster[i].phash.as_deref().unwrap();
            let hj = cluster[j].phash.as_deref().unwrap();
            if hi.contains(';') || hj.contains(';') {
                hamming_distance_multi(hi, hj)
            } else {
                hamming_distance(hi, hj)
            }
        })
        .max()
        .unwrap_or(0)
}

/// BK-tree accelerated grouping for single-frame phashes (images and FirstFrame videos).
fn group_single_frame(records: &[&FileRecord], threshold: u32) -> Vec<DuplicateGroup> {
    let parsed: Vec<(u64, &FileRecord)> = records
        .iter()
        .filter_map(|r| {
            u64::from_str_radix(r.phash.as_deref().unwrap_or(""), 16)
                .ok()
                .map(|h| (h, *r))
        })
        .collect();
    let n = parsed.len();
    if n == 0 {
        return Vec::new();
    }

    let mut tree = BkTree::new();
    for (i, (hash, _)) in parsed.iter().enumerate() {
        tree.insert(*hash, i);
    }

    // BkTree is Send + Sync (all-primitive storage), so find_within queries are safe to
    // run in parallel. Each query is read-only — no tree mutation during this phase.
    let neighbor_lists: Vec<Vec<usize>> = (0..n)
        .into_par_iter()
        .map(|i| tree.find_within(parsed[i].0, threshold))
        .collect();

    // Cluster assignment is order-dependent (greedy) — must stay sequential.
    let mut assigned = vec![false; n];
    let mut groups = Vec::new();

    for i in 0..n {
        if assigned[i] { continue; }
        let unassigned: Vec<usize> = neighbor_lists[i]
            .iter()
            .copied()
            .filter(|&j| !assigned[j])
            .collect();
        let cluster: Vec<&FileRecord> = unassigned.iter().map(|&j| {
            assigned[j] = true;
            parsed[j].1
        }).collect();

        if cluster.len() >= 2 {
            let max_dist = compute_max_distance(&cluster);
            groups.push(make_group(cluster, DuplicateType::Perceptual, Some(max_dist)));
        }
    }
    groups
}

/// O(n²) grouping for multi-frame phashes (MultiFrame video strategy only — small set).
fn group_multi_frame(records: &[&FileRecord], threshold: u32) -> Vec<DuplicateGroup> {
    let n = records.len();
    let mut assigned = vec![false; n];
    let mut groups = Vec::new();

    for i in 0..n {
        if assigned[i] { continue; }
        let hi = records[i].phash.as_deref().unwrap();
        let mut cluster: Vec<&FileRecord> = vec![records[i]];
        assigned[i] = true;

        for j in (i + 1)..n {
            if assigned[j] { continue; }
            let hj = records[j].phash.as_deref().unwrap();
            if hamming_distance_multi(hi, hj).map_or(false, |d| d <= threshold) {
                cluster.push(records[j]);
                assigned[j] = true;
            }
        }

        if cluster.len() >= 2 {
            let max_dist = compute_max_distance(&cluster);
            groups.push(make_group(cluster, DuplicateType::Perceptual, Some(max_dist)));
        }
    }
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
        .map(|members| make_group(members, DuplicateType::Filename, None))
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
        .map(|members| make_group(members, DuplicateType::Exact, None))
        .collect()
}

fn group_by_phash(records: &[FileRecord], threshold: u32) -> Vec<DuplicateGroup> {
    let with_hash: Vec<&FileRecord> = records.iter().filter(|r| r.phash.is_some()).collect();
    if with_hash.is_empty() {
        return Vec::new();
    }

    let mut single_refs: Vec<&FileRecord> = Vec::new();
    let mut multi_refs: Vec<&FileRecord> = Vec::new();
    for r in &with_hash {
        if r.phash.as_deref().unwrap_or("").contains(';') {
            multi_refs.push(r);
        } else {
            single_refs.push(r);
        }
    }

    let mut groups = Vec::new();
    groups.extend(group_single_frame(&single_refs, threshold));
    groups.extend(group_multi_frame(&multi_refs, threshold));
    groups
}

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
        let groups = find_duplicates(&records, &ScanMode::Content, 8, |_| {});
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
        let groups = find_duplicates(&records, &ScanMode::Filename, 8, |_| {});
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].duplicate_type, DuplicateType::Filename);
    }

    #[test]
    fn no_group_for_unique_files() {
        let records = vec![
            rec("/a/img1.jpg", 1000, "hash_a", None),
            rec("/b/img2.jpg", 2000, "hash_b", None),
        ];
        let groups = find_duplicates(&records, &ScanMode::Content, 8, |_| {});
        assert_eq!(groups.len(), 0);
    }

    #[test]
    fn wasted_bytes_correct() {
        let records = vec![
            rec("/a/img1.jpg", 1000, "same", None),
            rec("/b/img2.jpg", 1000, "same", None),
            rec("/c/img3.jpg", 1000, "same", None),
        ];
        let groups = find_duplicates(&records, &ScanMode::Content, 8, |_| {});
        assert_eq!(groups[0].wasted_bytes, 2000);
    }

    #[test]
    fn perceptual_group_max_distance_computed() {
        // h1=0, h2=1-bit-from-h1, h3=2-bits-from-h1, all within threshold=8
        let h1 = "0000000000000000";
        let h2 = "0000000000000001"; // distance 1 from h1
        let h3 = "0000000000000011"; // distance 2 from h1, distance 1 from h2
        let records = vec![
            FileRecord {
                path: "/a.jpg".to_string(), size: 100, mtime: 0,
                exact_hash: None, phash: Some(h1.to_string()),
                media_type: MediaType::Image,
            },
            FileRecord {
                path: "/b.jpg".to_string(), size: 100, mtime: 0,
                exact_hash: None, phash: Some(h2.to_string()),
                media_type: MediaType::Image,
            },
            FileRecord {
                path: "/c.jpg".to_string(), size: 100, mtime: 0,
                exact_hash: None, phash: Some(h3.to_string()),
                media_type: MediaType::Image,
            },
        ];
        let groups = find_duplicates(&records, &ScanMode::Content, 8, |_| {});
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
        let groups = find_duplicates(&records, &ScanMode::Content, 8, |_| {});
        assert_eq!(groups[0].max_distance, None);
    }

    #[test]
    fn progress_callback_receives_phase_strings() {
        use std::sync::{Arc, Mutex};
        let records = vec![
            rec("/a/img1.jpg", 1000, "hash_abc", Some("0000000000000000")),
            rec("/b/img2.jpg", 1000, "hash_abc", Some("0000000000000001")),
        ];
        let phases: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let phases_clone = Arc::clone(&phases);
        find_duplicates(&records, &ScanMode::Both, 8, move |p| {
            phases_clone.lock().unwrap().push(p.to_string());
        });
        let called = phases.lock().unwrap();
        assert!(called.contains(&"filename".to_string()));
        assert!(called.contains(&"exact".to_string()));
        assert!(called.contains(&"perceptual".to_string()));
    }
}
