/// BK-tree metric-space index for perceptual hash similarity search.
///
/// Each node stores a hash and edges labeled with the Hamming distance to each child.
/// The triangle inequality lets `find_within` skip entire subtrees: if a node is
/// distance `d` from the query, any child reachable via edge `w` can only hold
/// matches if `|w - d| <= threshold`. This prunes O(n²) comparisons down to O(n log n).
///
/// Storage is a flat Vec (arena) — no heap allocation per node, no pointer chasing.
/// Node layout: `(hash, original_index, children[(edge_dist, child_arena_index)])`.
pub struct BkTree {
    nodes: Vec<(u64, usize, Vec<(u32, usize)>)>,
}

impl BkTree {
    pub fn new() -> Self {
        Self { nodes: Vec::new() }
    }

    pub fn insert(&mut self, hash: u64, idx: usize) {
        if self.nodes.is_empty() {
            self.nodes.push((hash, idx, Vec::new()));
            return;
        }
        let mut current = 0usize;
        loop {
            // Hamming distance = number of differing bits between the two hashes.
            let d = (self.nodes[current].0 ^ hash).count_ones();
            // Each node has at most one child per distinct distance value.
            // If a child already exists at this distance, walk down to it.
            let child_pos = self.nodes[current].2.iter().position(|&(dist, _)| dist == d);
            if let Some(pos) = child_pos {
                current = self.nodes[current].2[pos].1;
            } else {
                // No child at this distance — attach a new leaf here.
                let new_idx = self.nodes.len();
                self.nodes.push((hash, idx, Vec::new()));
                self.nodes[current].2.push((d, new_idx));
                break;
            }
        }
    }

    /// Return original indices of all items within `threshold` Hamming distance of `query`.
    ///
    /// Iterative DFS with triangle-inequality pruning. For a node at distance `d` from the
    /// query, a child reachable via edge `w` must satisfy `|w - d| <= threshold` to possibly
    /// contain a match — any other branch is provably too far and skipped entirely.
    pub fn find_within(&self, query: u64, threshold: u32) -> Vec<usize> {
        if self.nodes.is_empty() {
            return Vec::new();
        }
        let mut results = Vec::new();
        let mut stack = vec![0usize];
        while let Some(node_idx) = stack.pop() {
            let (hash, orig_idx, _) = self.nodes[node_idx];
            let d = (hash ^ query).count_ones();
            if d <= threshold {
                results.push(orig_idx);
            }
            for &(child_dist, child_idx) in &self.nodes[node_idx].2 {
                if child_dist.abs_diff(d) <= threshold {
                    stack.push(child_idx);
                }
            }
        }
        results
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_tree_finds_nothing() {
        let tree = BkTree::new();
        assert!(tree.find_within(0, 10).is_empty());
    }

    #[test]
    fn single_item_found_within_threshold() {
        let mut tree = BkTree::new();
        tree.insert(0b1111u64, 42);
        assert_eq!(tree.find_within(0b1111u64, 0), vec![42]);
    }

    #[test]
    fn single_item_not_found_beyond_threshold() {
        let mut tree = BkTree::new();
        tree.insert(0u64, 0);
        assert!(tree.find_within(u64::MAX, 8).is_empty()); // distance 64 > threshold 8
    }

    #[test]
    fn finds_all_within_threshold() {
        let mut tree = BkTree::new();
        let h0 = 0u64;
        let h1 = 1u64;      // 1 bit different from h0
        let h2 = 0b11u64;   // 2 bits different from h0
        let h8 = 0xFFu64;   // 8 bits different from h0
        let h9 = 0x1FFu64;  // 9 bits different from h0
        tree.insert(h0, 0);
        tree.insert(h1, 1);
        tree.insert(h2, 2);
        tree.insert(h8, 3);
        tree.insert(h9, 4);

        let mut found = tree.find_within(h0, 8);
        found.sort();
        assert_eq!(found, vec![0, 1, 2, 3]); // h9 (distance 9) excluded
    }

    #[test]
    fn duplicate_hashes_both_returned() {
        let mut tree = BkTree::new();
        tree.insert(0u64, 0);
        tree.insert(0u64, 1); // same hash, different original index
        let mut found = tree.find_within(0u64, 0);
        found.sort();
        assert_eq!(found, vec![0, 1]);
    }
}
