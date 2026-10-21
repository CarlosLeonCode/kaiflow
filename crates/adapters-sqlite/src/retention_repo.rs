use std::sync::Mutex;

use application::ports::{PortResult, RetentionRepository};
use domain::UtcMs;
use rusqlite::Connection;

use crate::db::{lock, port_err};

/// Deletion of tracked data (R10.4). Open segments are never removed by range or age.
pub struct SqliteRetentionRepository {
    conn: Mutex<Connection>,
}

impl SqliteRetentionRepository {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }
}

impl RetentionRepository for SqliteRetentionRepository {
    fn delete_range(&self, from: UtcMs, to: UtcMs) -> PortResult<usize> {
        let conn = lock(&self.conn, "retention")?;
        conn.execute(
            "DELETE FROM segments
             WHERE ended_at IS NOT NULL AND started_at >= ?1 AND started_at < ?2",
            [from.0, to.0],
        )
        .map_err(port_err)
    }

    fn count_older_than(&self, cutoff: UtcMs) -> PortResult<usize> {
        let conn = lock(&self.conn, "retention")?;
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM segments WHERE ended_at IS NOT NULL AND ended_at < ?1",
                [cutoff.0],
                |row| row.get(0),
            )
            .map_err(port_err)?;
        Ok(usize::try_from(n).unwrap_or(0))
    }

    fn purge_older_than(&self, cutoff: UtcMs) -> PortResult<usize> {
        let mut conn = lock(&self.conn, "retention")?;
        let tx = conn.transaction().map_err(port_err)?;
        let segments = tx
            .execute(
                "DELETE FROM segments WHERE ended_at IS NOT NULL AND ended_at < ?1",
                [cutoff.0],
            )
            .map_err(port_err)?;
        // Pending gaps still wait for an answer; everything else is history.
        tx.execute(
            "DELETE FROM idle_gaps WHERE status <> 'pending' AND ended_at < ?1",
            [cutoff.0],
        )
        .map_err(port_err)?;
        tx.commit().map_err(port_err)?;
        Ok(segments)
    }

    fn delete_all(&self) -> PortResult<()> {
        let mut conn = lock(&self.conn, "retention")?;
        let tx = conn.transaction().map_err(port_err)?;
        tx.execute("DELETE FROM segments", []).map_err(port_err)?;
        tx.execute("DELETE FROM idle_gaps", []).map_err(port_err)?;
        tx.commit().map_err(port_err)?;
        // VACUUM cannot run inside a transaction. It rewrites the file so deleted rows do not
        // linger in free pages; the checkpoint then drops them from the WAL as well.
        conn.execute_batch("VACUUM").map_err(port_err)?;
        conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
            .map_err(port_err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{SqliteSessionRepository, open};
    use application::ports::SessionRepository;
    use domain::{EndReason, FocusSnapshot, GapStatus, IdleGap};

    fn focus() -> FocusSnapshot {
        FocusSnapshot {
            app_id: "a".into(),
            app_name: "A".into(),
            pid: 1,
            window_title: Some("t".into()),
        }
    }

    fn gap(start: i64, end: i64, status: GapStatus) -> IdleGap {
        IdleGap {
            id: None,
            started_at: UtcMs(start),
            ended_at: UtcMs(end),
            prev_focus: None,
            status,
            expires_at: UtcMs(end + 600_000),
        }
    }

    /// Writer and retention repos on one file; three closed segments at 10, 20, 30 and an open one.
    fn fixture() -> (
        tempfile::TempDir,
        std::path::PathBuf,
        SqliteSessionRepository,
        SqliteRetentionRepository,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let mut w = SqliteSessionRepository::new(open(&path).unwrap());
        for start in [10, 20, 30] {
            w.open_segment(&focus(), UtcMs(start)).unwrap();
            w.close_open_segment(UtcMs(start + 5), EndReason::FocusChange)
                .unwrap();
        }
        w.open_segment(&focus(), UtcMs(40)).unwrap();
        let r = SqliteRetentionRepository::new(open(&path).unwrap());
        (dir, path, w, r)
    }

    fn count(path: &std::path::Path, table: &str) -> i64 {
        open(path)
            .unwrap()
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn purge_removes_only_closed_segments_that_ended_before_cutoff() {
        let (_d, path, mut w, r) = fixture();
        w.insert_gap(&gap(0, 12, GapStatus::Expired)).unwrap();
        w.insert_gap(&gap(0, 12, GapStatus::Pending)).unwrap();
        w.insert_gap(&gap(50, 60, GapStatus::Expired)).unwrap();
        // Segments end at 15, 25, 35: cutoff 26 drops the first two.
        assert_eq!(r.count_older_than(UtcMs(26)).unwrap(), 2, "dry run matches");
        assert_eq!(count(&path, "segments"), 4, "counting deletes nothing");
        assert_eq!(r.purge_older_than(UtcMs(26)).unwrap(), 2);
        assert_eq!(count(&path, "segments"), 2);
        // Old pending gap survives, old expired one goes, recent one stays.
        assert_eq!(count(&path, "idle_gaps"), 2);
        assert_eq!(r.purge_older_than(UtcMs(1_000_000)).unwrap(), 1);
        assert_eq!(count(&path, "segments"), 1, "open segment is never purged");
    }

    #[test]
    fn delete_range_uses_start_time_and_skips_open_segments() {
        let (_d, path, _w, r) = fixture();
        assert_eq!(r.delete_range(UtcMs(20), UtcMs(31)).unwrap(), 2);
        assert_eq!(r.delete_range(UtcMs(0), UtcMs(1_000)).unwrap(), 1);
        assert_eq!(count(&path, "segments"), 1);
    }

    #[test]
    fn delete_all_empties_tracked_data_but_keeps_config_and_vacuums() {
        let (_d, path, mut w, r) = fixture();
        w.insert_gap(&gap(0, 12, GapStatus::Pending)).unwrap();
        let conn = open(&path).unwrap();
        conn.execute(
            "INSERT INTO privacy_rules(app_id, mode) VALUES ('x', 'exclude')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO settings(key, value) VALUES ('theme', '1')", [])
            .unwrap();
        r.delete_all().unwrap();
        assert_eq!(count(&path, "segments"), 0);
        assert_eq!(count(&path, "idle_gaps"), 0);
        assert_eq!(count(&path, "privacy_rules"), 1);
        assert_eq!(count(&path, "settings"), 1);
        assert_eq!(count(&path, "activities"), 1, "system activity stays");
        let free: i64 = conn
            .query_row("PRAGMA freelist_count", [], |r| r.get(0))
            .unwrap();
        assert_eq!(free, 0, "VACUUM leaves no free pages");
    }
}
