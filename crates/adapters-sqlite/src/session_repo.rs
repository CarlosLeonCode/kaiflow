use application::ports::{PortError, PortResult, SessionRepository};
use domain::{
    AssignedSpan, CategoryId, EndReason, FocusSnapshot, GapId, GapStatus, IdleGap, IdleResolution,
    SegmentId, UtcMs,
};
use rusqlite::{Connection, params};

use crate::db::port_err;

fn reason_to_sql(reason: EndReason) -> &'static str {
    match reason {
        EndReason::FocusChange => "focus_change",
        EndReason::Idle => "idle",
        EndReason::Sleep => "sleep",
        EndReason::Lock => "lock",
        EndReason::Pause => "pause",
        EndReason::Stop => "stop",
        EndReason::Shutdown => "shutdown",
        EndReason::Recovered => "recovered",
    }
}

/// (status column, category column) for a gap status.
fn status_to_sql(status: GapStatus) -> (&'static str, Option<i64>) {
    match status {
        GapStatus::Pending => ("pending", None),
        GapStatus::Expired => ("expired", None),
        GapStatus::Resolved(IdleResolution::Discard) => ("discard", None),
        GapStatus::Resolved(IdleResolution::AssignPrevious) => ("assign_previous", None),
        GapStatus::Resolved(IdleResolution::AssignCategory(c)) => ("assign_category", Some(c.0)),
    }
}

fn status_from_sql(status: &str, category: Option<i64>) -> Result<GapStatus, PortError> {
    Ok(match (status, category) {
        ("pending", _) => GapStatus::Pending,
        ("expired", _) => GapStatus::Expired,
        ("discard", _) => GapStatus::Resolved(IdleResolution::Discard),
        ("assign_previous", _) => GapStatus::Resolved(IdleResolution::AssignPrevious),
        ("assign_category", Some(c)) => {
            GapStatus::Resolved(IdleResolution::AssignCategory(CategoryId(c)))
        }
        (other, _) => return Err(PortError(format!("invalid idle gap status: {other}"))),
    })
}

/// Write side of the segment store; owned by the engine thread (one writer connection).
pub struct SqliteSessionRepository {
    conn: Connection,
}

impl SqliteSessionRepository {
    /// `conn` must come from [`crate::open`] / [`crate::open_in_memory`] (migrated, PRAGMAs set).
    pub fn new(conn: Connection) -> Self {
        Self { conn }
    }
}

impl SessionRepository for SqliteSessionRepository {
    fn open_segment(&mut self, focus: &FocusSnapshot, at: UtcMs) -> PortResult<SegmentId> {
        self.conn
            .execute(
                "INSERT INTO segments(started_at, heartbeat_at, app_id, app_name, window_title, source)
                 VALUES (?1, ?1, ?2, ?3, ?4, 'tracked')",
                params![at.0, focus.app_id, focus.app_name, focus.window_title],
            )
            .map_err(port_err)?;
        Ok(SegmentId(self.conn.last_insert_rowid()))
    }

    fn close_open_segment(&mut self, at: UtcMs, reason: EndReason) -> PortResult<()> {
        // `max` keeps a clock that stepped backwards from violating `ended_at >= started_at`.
        self.conn
            .execute(
                "UPDATE segments SET ended_at = max(?1, started_at), end_reason = ?2,
                        heartbeat_at = max(heartbeat_at, started_at)
                 WHERE ended_at IS NULL",
                params![at.0, reason_to_sql(reason)],
            )
            .map(|_| ())
            .map_err(port_err)
    }

    fn heartbeat(&mut self, at: UtcMs) -> PortResult<()> {
        self.conn
            .execute(
                "UPDATE segments SET heartbeat_at = ?1 WHERE ended_at IS NULL",
                [at.0],
            )
            .map(|_| ())
            .map_err(port_err)
    }

    fn insert_assigned(&mut self, span: &AssignedSpan) -> PortResult<SegmentId> {
        self.conn
            .execute(
                "INSERT INTO segments(started_at, ended_at, heartbeat_at, app_id, app_name,
                                      window_title, end_reason, source, category_id)
                 VALUES (?1, ?2, ?2, ?3, ?4, ?5, 'idle', 'idle_assigned', ?6)",
                params![
                    span.started_at.0,
                    span.ended_at.0,
                    span.app_id,
                    span.app_name,
                    span.window_title,
                    span.category_id.map(|c| c.0)
                ],
            )
            .map_err(port_err)?;
        Ok(SegmentId(self.conn.last_insert_rowid()))
    }

    fn insert_gap(&mut self, gap: &IdleGap) -> PortResult<GapId> {
        let (status, category) = status_to_sql(gap.status);
        let prev = gap.prev_focus.as_ref();
        self.conn
            .execute(
                "INSERT INTO idle_gaps(started_at, ended_at, prev_app_id, prev_app_name, prev_title,
                                       status, category_id, expires_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    gap.started_at.0,
                    gap.ended_at.0,
                    prev.map(|f| f.app_id.as_str()),
                    prev.map(|f| f.app_name.as_str()),
                    prev.and_then(|f| f.window_title.as_deref()),
                    status,
                    category,
                    gap.expires_at.0
                ],
            )
            .map_err(port_err)?;
        Ok(GapId(self.conn.last_insert_rowid()))
    }

    fn update_gap_status(&mut self, id: GapId, status: GapStatus, at: UtcMs) -> PortResult<()> {
        let (status, category) = status_to_sql(status);
        let changed = self
            .conn
            .execute(
                "UPDATE idle_gaps SET status = ?1, category_id = ?2, resolved_at = ?3 WHERE id = ?4",
                params![status, category, at.0, id.0],
            )
            .map_err(port_err)?;
        if changed == 0 {
            return Err(PortError(format!("idle gap {} not found", id.0)));
        }
        Ok(())
    }

    fn pending_gaps(&mut self) -> PortResult<Vec<IdleGap>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, started_at, ended_at, prev_app_id, prev_app_name, prev_title,
                        status, category_id, expires_at
                 FROM idle_gaps WHERE status = 'pending' ORDER BY started_at, id",
            )
            .map_err(port_err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, Option<i64>>(7)?,
                    r.get::<_, i64>(8)?,
                ))
            })
            .map_err(port_err)?;
        let mut gaps = Vec::new();
        for row in rows {
            let (id, start, end, app_id, app_name, title, status, cat, expires) =
                row.map_err(port_err)?;
            // The pid is not persisted (it is meaningless after a restart).
            let prev_focus = match (app_id, app_name) {
                (Some(app_id), Some(app_name)) => Some(FocusSnapshot {
                    app_id,
                    app_name,
                    pid: 0,
                    window_title: title,
                }),
                _ => None,
            };
            gaps.push(IdleGap {
                id: Some(GapId(id)),
                started_at: UtcMs(start),
                ended_at: UtcMs(end),
                prev_focus,
                status: status_from_sql(&status, cat)?,
                expires_at: UtcMs(expires),
            });
        }
        Ok(gaps)
    }

    fn recover_orphans(&mut self) -> PortResult<usize> {
        self.conn
            .execute(
                "UPDATE segments SET ended_at = max(heartbeat_at, started_at), end_reason = 'recovered'
                 WHERE ended_at IS NULL",
                [],
            )
            .map_err(port_err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use domain::UNCATEGORIZED;

    fn repo() -> SqliteSessionRepository {
        SqliteSessionRepository::new(open_in_memory().unwrap())
    }

    fn focus(app: &str, title: Option<&str>) -> FocusSnapshot {
        FocusSnapshot {
            app_id: app.into(),
            app_name: app.to_uppercase(),
            pid: 42,
            window_title: title.map(Into::into),
        }
    }

    fn row(
        repo: &SqliteSessionRepository,
        id: SegmentId,
    ) -> (i64, Option<i64>, i64, Option<String>, String) {
        repo.conn
            .query_row(
                "SELECT started_at, ended_at, heartbeat_at, end_reason, source FROM segments WHERE id = ?1",
                [id.0],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap()
    }

    fn span(app: Option<&str>, category: Option<CategoryId>) -> AssignedSpan {
        AssignedSpan {
            started_at: UtcMs(100),
            ended_at: UtcMs(200),
            app_id: app.map(Into::into),
            app_name: app.map(|a| a.to_uppercase()),
            window_title: None,
            category_id: category,
        }
    }

    #[test]
    fn open_heartbeat_close_cycle() {
        let mut r = repo();
        let id = r.open_segment(&focus("a", Some("t")), UtcMs(1000)).unwrap();
        assert_eq!(row(&r, id), (1000, None, 1000, None, "tracked".into()));
        r.heartbeat(UtcMs(1500)).unwrap();
        r.close_open_segment(UtcMs(2000), EndReason::FocusChange)
            .unwrap();
        assert_eq!(
            row(&r, id),
            (
                1000,
                Some(2000),
                1500,
                Some("focus_change".into()),
                "tracked".into()
            )
        );
    }

    #[test]
    fn close_and_heartbeat_without_open_segment_are_no_ops() {
        let mut r = repo();
        r.close_open_segment(UtcMs(5), EndReason::Stop).unwrap();
        r.heartbeat(UtcMs(5)).unwrap();
        let id = r.open_segment(&focus("a", None), UtcMs(10)).unwrap();
        r.close_open_segment(UtcMs(20), EndReason::Stop).unwrap();
        r.close_open_segment(UtcMs(99), EndReason::Shutdown)
            .unwrap();
        assert_eq!(row(&r, id).1, Some(20), "second close must not rewrite");
    }

    #[test]
    fn backwards_clock_never_violates_the_end_check() {
        let mut r = repo();
        let id = r.open_segment(&focus("a", None), UtcMs(1000)).unwrap();
        r.close_open_segment(UtcMs(900), EndReason::Sleep).unwrap();
        assert_eq!(row(&r, id).1, Some(1000));
    }

    #[test]
    fn unique_index_rejects_a_second_open_segment() {
        let mut r = repo();
        r.open_segment(&focus("a", None), UtcMs(1)).unwrap();
        assert!(r.open_segment(&focus("b", None), UtcMs(2)).is_err());
        r.close_open_segment(UtcMs(3), EndReason::FocusChange)
            .unwrap();
        r.open_segment(&focus("b", None), UtcMs(3)).unwrap();
    }

    #[test]
    fn assigned_segments_may_coexist_with_an_open_one() {
        let mut r = repo();
        r.open_segment(&focus("a", None), UtcMs(1)).unwrap();
        let id = r.insert_assigned(&span(Some("a"), None)).unwrap();
        assert_eq!(
            row(&r, id),
            (
                100,
                Some(200),
                200,
                Some("idle".into()),
                "idle_assigned".into()
            )
        );
    }

    #[test]
    fn source_checks_hold_at_the_sql_level() {
        let r = repo();
        let exec = |sql: &str| r.conn.execute(sql, []);
        // tracked requires app_id
        assert!(
            exec("INSERT INTO segments(started_at, heartbeat_at, source) VALUES (1, 1, 'tracked')")
                .is_err()
        );
        // unknown source
        assert!(exec("INSERT INTO segments(started_at, heartbeat_at, app_id, source) VALUES (1, 1, 'a', 'x')").is_err());
        // idle_assigned needs end_reason idle
        assert!(exec("INSERT INTO segments(started_at, ended_at, heartbeat_at, app_id, end_reason, source) VALUES (1, 2, 2, 'a', 'stop', 'idle_assigned')").is_err());
        // idle_assigned needs app or category
        assert!(exec("INSERT INTO segments(started_at, ended_at, heartbeat_at, end_reason, source) VALUES (1, 2, 2, 'idle', 'idle_assigned')").is_err());
        // ended before started
        assert!(exec("INSERT INTO segments(started_at, ended_at, heartbeat_at, app_id) VALUES (5, 4, 4, 'a')").is_err());
        // unknown end reason
        assert!(exec("INSERT INTO segments(started_at, ended_at, heartbeat_at, app_id, end_reason) VALUES (1, 2, 2, 'a', 'bogus')").is_err());
    }

    #[test]
    fn assign_category_allows_null_app_but_requires_the_category() {
        let mut r = repo();
        let id = r.insert_assigned(&span(None, Some(UNCATEGORIZED))).unwrap();
        let (app, cat): (Option<String>, Option<i64>) = r
            .conn
            .query_row(
                "SELECT app_id, category_id FROM segments WHERE id = ?1",
                [id.0],
                |x| Ok((x.get(0)?, x.get(1)?)),
            )
            .unwrap();
        assert_eq!((app, cat), (None, Some(1)));
        assert!(r.insert_assigned(&span(None, None)).is_err());
        assert!(
            r.insert_assigned(&span(None, Some(CategoryId(999))))
                .is_err(),
            "FK enforced"
        );
    }

    #[test]
    fn recover_orphans_closes_at_heartbeat_with_recovered() {
        let mut r = repo();
        let id = r.open_segment(&focus("a", None), UtcMs(1000)).unwrap();
        r.heartbeat(UtcMs(4000)).unwrap();
        assert_eq!(r.recover_orphans().unwrap(), 1);
        assert_eq!(
            row(&r, id),
            (
                1000,
                Some(4000),
                4000,
                Some("recovered".into()),
                "tracked".into()
            )
        );
        assert_eq!(r.recover_orphans().unwrap(), 0);
        r.open_segment(&focus("b", None), UtcMs(5000)).unwrap();
    }

    #[test]
    fn gaps_roundtrip_and_only_pending_are_listed() {
        let mut r = repo();
        let g1 = IdleGap::pending(UtcMs(10), UtcMs(20), Some(focus("a", Some("t"))), UtcMs(20));
        let g2 = IdleGap::pending(UtcMs(30), UtcMs(40), None, UtcMs(40));
        let id1 = r.insert_gap(&g1).unwrap();
        let id2 = r.insert_gap(&g2).unwrap();

        let pending = r.pending_gaps().unwrap();
        assert_eq!(pending.len(), 2);
        assert_eq!(pending[0].id, Some(id1));
        assert_eq!(pending[0].expires_at, g1.expires_at);
        let prev = pending[0].prev_focus.as_ref().unwrap();
        assert_eq!(
            (prev.app_id.as_str(), prev.window_title.as_deref()),
            ("a", Some("t"))
        );
        assert_eq!(pending[1].prev_focus, None);

        r.update_gap_status(
            id1,
            GapStatus::Resolved(IdleResolution::AssignCategory(UNCATEGORIZED)),
            UtcMs(25),
        )
        .unwrap();
        r.update_gap_status(id2, GapStatus::Expired, UtcMs(50))
            .unwrap();
        assert!(r.pending_gaps().unwrap().is_empty());

        let (status, cat, resolved): (String, Option<i64>, i64) = r
            .conn
            .query_row(
                "SELECT status, category_id, resolved_at FROM idle_gaps WHERE id = ?1",
                [id1.0],
                |x| Ok((x.get(0)?, x.get(1)?, x.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (status.as_str(), cat, resolved),
            ("assign_category", Some(1), 25)
        );
    }

    #[test]
    fn updating_a_missing_gap_fails() {
        let mut r = repo();
        assert!(
            r.update_gap_status(GapId(7), GapStatus::Expired, UtcMs(1))
                .is_err()
        );
    }

    #[test]
    fn status_mapping_roundtrips() {
        for s in [
            GapStatus::Pending,
            GapStatus::Expired,
            GapStatus::Resolved(IdleResolution::Discard),
            GapStatus::Resolved(IdleResolution::AssignPrevious),
            GapStatus::Resolved(IdleResolution::AssignCategory(CategoryId(1))),
        ] {
            let (text, cat) = status_to_sql(s);
            assert_eq!(status_from_sql(text, cat).unwrap(), s);
        }
        assert!(status_from_sql("bogus", None).is_err());
    }
}
