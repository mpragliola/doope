use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use std::path::Path;
use crate::models::{FileRecord, MediaType};

pub struct Cache {
    conn: Connection,
}

impl Cache {
    pub fn open(db_path: &Path) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)
            .context("failed to open SQLite database")?;
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS files (
                path        TEXT PRIMARY KEY,
                size        INTEGER NOT NULL,
                mtime       INTEGER NOT NULL,
                exact_hash  TEXT,
                phash       TEXT,
                media_type  TEXT NOT NULL,
                scanned_at  INTEGER NOT NULL
            );
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=NORMAL;
        ")?;
        Ok(Self { conn })
    }

    pub fn get(&self, path: &str, size: u64, mtime: u64) -> Result<Option<FileRecord>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT path, size, mtime, exact_hash, phash, media_type
             FROM files WHERE path = ? AND size = ? AND mtime = ?"
        )?;
        let result = stmt.query_row(params![path, size as i64, mtime as i64], |row| {
            let media_type_str: String = row.get(5)?;
            let media_type = if media_type_str == "image" {
                MediaType::Image
            } else {
                MediaType::Video
            };
            Ok(FileRecord {
                path: row.get(0)?,
                size: row.get::<_, i64>(1)? as u64,
                mtime: row.get::<_, i64>(2)? as u64,
                exact_hash: row.get(3)?,
                phash: row.get(4)?,
                media_type,
            })
        });
        match result {
            Ok(r) => Ok(Some(r)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn upsert(&self, record: &FileRecord) -> Result<()> {
        let media_type_str = match record.media_type {
            MediaType::Image => "image",
            MediaType::Video => "video",
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        self.conn.execute(
            "INSERT OR REPLACE INTO files
             (path, size, mtime, exact_hash, phash, media_type, scanned_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                record.path,
                record.size as i64,
                record.mtime as i64,
                record.exact_hash,
                record.phash,
                media_type_str,
                now as i64,
            ],
        )?;
        Ok(())
    }

    /// Write all records in a single BEGIN/COMMIT transaction.
    /// ~100× faster than individual upserts for large batches.
    pub fn upsert_batch(&self, records: &[FileRecord]) -> Result<()> {
        if records.is_empty() {
            return Ok(());
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        self.conn.execute_batch("BEGIN")?;
        let result: Result<()> = (|| {
            for record in records {
                let media_type_str = match record.media_type {
                    MediaType::Image => "image",
                    MediaType::Video => "video",
                };
                self.conn.execute(
                    "INSERT OR REPLACE INTO files
                     (path, size, mtime, exact_hash, phash, media_type, scanned_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)",
                    params![
                        record.path,
                        record.size as i64,
                        record.mtime as i64,
                        record.exact_hash,
                        record.phash,
                        media_type_str,
                        now as i64,
                    ],
                )?;
            }
            Ok(())
        })();
        if result.is_ok() {
            self.conn.execute_batch("COMMIT")?;
        } else {
            self.conn.execute_batch("ROLLBACK").ok();
            result?;
        }
        Ok(())
    }

    pub fn clear(&self) -> Result<()> {
        self.conn.execute("DELETE FROM files", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::MediaType;
    use tempfile::tempdir;

    fn make_record(path: &str) -> FileRecord {
        FileRecord {
            path: path.to_string(),
            size: 1024,
            mtime: 1700000000,
            exact_hash: Some("abc123".to_string()),
            phash: Some("ff00ff00ff00ff00".to_string()),
            media_type: MediaType::Image,
        }
    }

    #[test]
    fn cache_miss_on_empty() {
        let dir = tempdir().unwrap();
        let cache = Cache::open(&dir.path().join("test.db")).unwrap();
        let result = cache.get("/some/path.jpg", 1024, 1700000000).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn upsert_then_hit() {
        let dir = tempdir().unwrap();
        let cache = Cache::open(&dir.path().join("test.db")).unwrap();
        let rec = make_record("/img/photo.jpg");
        cache.upsert(&rec).unwrap();
        let hit = cache.get("/img/photo.jpg", 1024, 1700000000).unwrap();
        assert!(hit.is_some());
        assert_eq!(hit.unwrap().exact_hash, Some("abc123".to_string()));
    }

    #[test]
    fn cache_miss_on_mtime_change() {
        let dir = tempdir().unwrap();
        let cache = Cache::open(&dir.path().join("test.db")).unwrap();
        cache.upsert(&make_record("/img/photo.jpg")).unwrap();
        let miss = cache.get("/img/photo.jpg", 1024, 9999999999).unwrap();
        assert!(miss.is_none());
    }

    #[test]
    fn upsert_batch_then_hit() {
        let dir = tempdir().unwrap();
        let cache = Cache::open(&dir.path().join("test.db")).unwrap();
        let records: Vec<FileRecord> = (0u64..5).map(|i| FileRecord {
            path: format!("/img/{}.jpg", i),
            size: 1000 + i,
            mtime: 1700000000,
            exact_hash: Some(format!("hash{}", i)),
            phash: None,
            media_type: MediaType::Image,
        }).collect();
        cache.upsert_batch(&records).unwrap();
        for r in &records {
            let hit = cache.get(&r.path, r.size, r.mtime).unwrap();
            assert!(hit.is_some(), "expected cache hit for {}", r.path);
        }
    }

    #[test]
    fn upsert_batch_empty_is_noop() {
        let dir = tempdir().unwrap();
        let cache = Cache::open(&dir.path().join("test.db")).unwrap();
        cache.upsert_batch(&[]).unwrap();
    }

    #[test]
    fn clear_empties_table() {
        let dir = tempdir().unwrap();
        let cache = Cache::open(&dir.path().join("test.db")).unwrap();
        cache.upsert(&make_record("/img/photo.jpg")).unwrap();
        cache.clear().unwrap();
        let miss = cache.get("/img/photo.jpg", 1024, 1700000000).unwrap();
        assert!(miss.is_none());
    }
}
