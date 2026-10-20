use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, TryLockError};

use application::ports::{PortError, PortResult, ReportRepository};
use domain::{CategoryId, Segment, SegmentId, SegmentSource, UtcMs};
use rusqlite::{Connection, OpenFlags, Row};

use crate::db::{DbError, port_err};
use crate::session_repo::reason_from_sql;

/// Number of read-only connections (design section 6).
const POOL_SIZE: usize = 2;

/// Read side: a small pool of read-only WAL connections so queries never block the engine.
pub struct SqliteReportRepository {
    pool: Vec<Mutex<Connection>>,
    next: AtomicUsize,
}

impl SqliteReportRepository {
    /// Opens the pool on an existing, migrated database file (create it with [`crate::open`]).
    pub fn open(path: &Path) -> Result<Self, DbError> {
        let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        let pool = (0..POOL_SIZE)
            .map(|_| Connection::open_with_flags(path, flags).map(Mutex::new))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            pool,
            next: AtomicUsize::new(0),
        })
    }

    /// Runs `f` on a free connection, waiting on a round-robin one when all are busy.
    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> PortResult<T>) -> PortResult<T> {
        let poisoned = || PortError("report connection poisoned".into());
        for slot in &self.pool {
            match slot.try_lock() {
                Ok(conn) => return f(&conn),
                Err(TryLockError::WouldBlock) => {}
                Err(TryLockError::Poisoned(_)) => return Err(poisoned()),
            }
        }
        let slot = &self.pool[self.next.fetch_add(1, Ordering::Relaxed) % self.pool.len()];
        let conn = slot.lock().map_err(|_| poisoned())?;
        f(&conn)
    }
}

fn segment_from_row(r: &Row<'_>) -> rusqlite::Result<Result<Segment, PortError>> {
    let reason: Option<String> = r.get(7)?;
    let source: String = r.get(8)?;
    let ended_at: Option<i64> = r.get(2)?;
    let category: Option<i64> = r.get(9)?;
    let parsed = (|| {
        Ok(Segment {
            id: SegmentId(r.get(0).map_err(port_err)?),
            started_at: UtcMs(r.get(1).map_err(port_err)?),
            ended_at: ended_at.map(UtcMs),
            heartbeat_at: UtcMs(r.get(3).map_err(port_err)?),
            app_id: r.get(4).map_err(port_err)?,
            app_name: r.get(5).map_err(port_err)?,
            window_title: r.get(6).map_err(port_err)?,
            end_reason: reason.as_deref().map(reason_from_sql).transpose()?,
            source: match source.as_str() {
                "tracked" => SegmentSource::Tracked,
                "idle_assigned" => SegmentSource::IdleAssigned,
                other => return Err(PortError(format!("invalid segment source: {other}"))),
            },
            category_id: category.map(CategoryId),
        })
    })();
    Ok(parsed)
}

impl ReportRepository for SqliteReportRepository {
    fn segments_in_range(&self, from: UtcMs, to: UtcMs) -> PortResult<Vec<Segment>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare_cached(
                    "SELECT id, started_at, ended_at, heartbeat_at, app_id, app_name, window_title,
                            end_reason, source, category_id
                     FROM segments
                     WHERE started_at < ?2 AND (ended_at IS NULL OR ended_at > ?1)
                     ORDER BY started_at, id",
                )
                .map_err(port_err)?;
            let rows = stmt
                .query_map([from.0, to.0], segment_from_row)
                .map_err(port_err)?;
            rows.map(|row| row.map_err(port_err)?).collect()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SqliteSessionRepository;
    use application::ports::SessionRepository;
    use domain::{AssignedSpan, EndReason, FocusSnapshot, clip_to_range, split_at_boundaries};

    fn focus(app: &str) -> FocusSnapshot {
        FocusSnapshot {
            app_id: app.into(),
            app_name: app.into(),
            pid: 1,
            window_title: Some("t".into()),
        }
    }

    /// File database (WAL needs a file) with a writer and the read pool.
    fn fixture() -> (
        tempfile::TempDir,
        SqliteSessionRepository,
        SqliteReportRepository,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let writer = SqliteSessionRepository::new(crate::db::open(&path).unwrap());
        let reader = SqliteReportRepository::open(&path).unwrap();
        (dir, writer, reader)
    }

    fn closed(w: &mut SqliteSessionRepository, app: &str, start: i64, end: i64) {
        w.open_segment(&focus(app), UtcMs(start)).unwrap();
        w.close_open_segment(UtcMs(end), EndReason::FocusChange)
            .unwrap();
    }

    #[test]
    fn returns_overlapping_segments_ordered_and_unclipped() {
        let (_dir, mut w, r) = fixture();
        closed(&mut w, "before", 0, 10);
        closed(&mut w, "edge-in", 5, 25);
        closed(&mut w, "inside", 30, 40);
        closed(&mut w, "touching-end", 50, 60);
        closed(&mut w, "after", 70, 80);
        let apps: Vec<_> = r
            .segments_in_range(UtcMs(20), UtcMs(50))
            .unwrap()
            .into_iter()
            .map(|s| s.app_id.unwrap())
            .collect();
        assert_eq!(apps, ["edge-in", "inside"]);
    }

    #[test]
    fn open_segment_overlaps_and_full_row_round_trips() {
        let (_dir, mut w, r) = fixture();
        w.insert_assigned(&AssignedSpan {
            started_at: UtcMs(0),
            ended_at: UtcMs(10),
            app_id: None,
            app_name: None,
            window_title: None,
            category_id: Some(CategoryId(1)),
        })
        .unwrap();
        w.open_segment(&focus("live"), UtcMs(100)).unwrap();
        let all = r.segments_in_range(UtcMs(0), UtcMs(1_000)).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].source, SegmentSource::IdleAssigned);
        assert_eq!(all[0].app_id, None);
        assert_eq!(all[0].category_id, Some(CategoryId(1)));
        assert_eq!(all[0].end_reason, Some(EndReason::Idle));
        assert_eq!(all[1].ended_at, None);
        assert_eq!(all[1].window_title.as_deref(), Some("t"));
    }

    #[test]
    fn midnight_crossing_segment_is_split_by_domain_clipping() {
        let (_dir, mut w, r) = fixture();
        let midnight = 1_000_000;
        closed(&mut w, "late", midnight - 600_000, midnight + 600_000);
        for (from, to, expected) in [
            (midnight - 86_400_000, midnight, 600_000),
            (midnight, midnight + 86_400_000, 600_000),
        ] {
            let segs = r.segments_in_range(UtcMs(from), UtcMs(to)).unwrap();
            assert_eq!(segs.len(), 1);
            let span = clip_to_range(&segs[0], UtcMs(from), UtcMs(to), UtcMs(to)).unwrap();
            assert_eq!(span.duration_ms(), expected);
            assert_eq!(split_at_boundaries(span, &[UtcMs(midnight)]).len(), 1);
        }
    }

    #[test]
    fn pool_is_read_only_and_sees_committed_writes() {
        let (_dir, mut w, r) = fixture();
        assert!(r.segments_in_range(UtcMs(0), UtcMs(10)).unwrap().is_empty());
        closed(&mut w, "a", 1, 5);
        assert_eq!(r.segments_in_range(UtcMs(0), UtcMs(10)).unwrap().len(), 1);
        let err = r
            .with_conn(|c| c.execute("DELETE FROM segments", []).map_err(port_err))
            .unwrap_err();
        assert!(err.0.contains("readonly"), "{err}");
    }

    #[test]
    fn concurrent_readers_all_succeed_with_two_connections() {
        let (_dir, mut w, r) = fixture();
        closed(&mut w, "a", 1, 5);
        let r = std::sync::Arc::new(r);
        let handles: Vec<_> = (0..4)
            .map(|_| {
                let r = r.clone();
                std::thread::spawn(move || {
                    (0..50).all(|_| r.segments_in_range(UtcMs(0), UtcMs(10)).unwrap().len() == 1)
                })
            })
            .collect();
        assert!(handles.into_iter().all(|h| h.join().unwrap()));
    }

    #[test]
    fn opening_a_missing_database_fails() {
        let dir = tempfile::tempdir().unwrap();
        assert!(SqliteReportRepository::open(&dir.path().join("none.db")).is_err());
    }
}
