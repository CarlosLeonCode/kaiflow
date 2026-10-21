use std::sync::Mutex;

use application::ports::{FocusRepository, PortError, PortResult, StoredFocus};
use domain::focus_session::Distraction;
use domain::{ActivityId, FocusAllowed, FocusEnd, FocusSummary, UtcMs};
use rusqlite::{Connection, Row, params};

use crate::db::{lock, port_err};

/// Focus sessions and their allowed sets (migration 0004).
pub struct SqliteFocusRepository {
    conn: Mutex<Connection>,
}

impl SqliteFocusRepository {
    /// `conn` must come from [`crate::open`] / [`crate::open_in_memory`].
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }
}

const COLUMNS: &str = "id, intent, started_at, planned_end, ended_at, end_reason, drift_alerts,
     inside_ms, outside_ms, distractions, seen";

/// Distractions are stored as a JSON array of `{app_id, app_name, ms}`.
pub fn distractions_to_json(list: &[Distraction]) -> String {
    let items: Vec<serde_json::Value> = list
        .iter()
        .map(|d| serde_json::json!({"app_id": d.app_id, "app_name": d.app_name, "ms": d.ms}))
        .collect();
    serde_json::Value::Array(items).to_string()
}

pub fn distractions_from_json(text: &str) -> PortResult<Vec<Distraction>> {
    let value: serde_json::Value = serde_json::from_str(text)
        .map_err(|e| PortError(format!("malformed focus distractions: {e}")))?;
    let items = value
        .as_array()
        .ok_or_else(|| PortError("malformed focus distractions".into()))?;
    items
        .iter()
        .map(|item| {
            Some(Distraction {
                app_id: item.get("app_id")?.as_str()?.to_owned(),
                app_name: item.get("app_name")?.as_str()?.to_owned(),
                ms: item.get("ms")?.as_i64()?,
            })
        })
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| PortError("malformed focus distraction".into()))
}

/// Everything but the allowed set, which lives in its own table.
fn session_from_row(r: &Row<'_>) -> rusqlite::Result<PortResult<StoredFocus>> {
    let id: i64 = r.get(0)?;
    let end_reason: Option<String> = r.get(5)?;
    let ended_at: Option<i64> = r.get(4)?;
    let drift_alerts: i64 = r.get(6)?;
    let distractions: String = r.get(9)?;
    let session = StoredFocus {
        id,
        intent: r.get(1)?,
        started_at: UtcMs(r.get(2)?),
        planned_end: UtcMs(r.get(3)?),
        ended_at: ended_at.map(UtcMs),
        end_reason: None,
        drift_alerts: u32::try_from(drift_alerts).unwrap_or(0),
        allowed: FocusAllowed::default(),
        summary: FocusSummary {
            inside_ms: r.get(7)?,
            outside_ms: r.get(8)?,
            top_distractions: Vec::new(),
        },
        seen: r.get::<_, i64>(10)? != 0,
    };
    Ok(finish_row(session, end_reason.as_deref(), &distractions))
}

fn finish_row(
    mut session: StoredFocus,
    end_reason: Option<&str>,
    distractions: &str,
) -> PortResult<StoredFocus> {
    if let Some(name) = end_reason {
        session.end_reason = Some(
            FocusEnd::parse(name)
                .ok_or_else(|| PortError(format!("malformed focus session {}", session.id)))?,
        );
    }
    session.summary.top_distractions = distractions_from_json(distractions)?;
    Ok(session)
}

fn load_allowed(conn: &Connection, session: i64) -> PortResult<FocusAllowed> {
    let mut stmt = conn
        .prepare(
            "SELECT app_id, activity_id FROM focus_allowed WHERE session_id = ?1
             ORDER BY app_id, activity_id",
        )
        .map_err(port_err)?;
    let rows = stmt
        .query_map([session], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<i64>>(1)?))
        })
        .map_err(port_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(port_err)?;
    let mut allowed = FocusAllowed::default();
    for (app, activity) in rows {
        if let Some(app) = app {
            allowed.apps.push(app);
        }
        if let Some(activity) = activity {
            allowed.activities.push(ActivityId(activity));
        }
    }
    Ok(allowed)
}

fn save_allowed(conn: &Connection, session: i64, allowed: &FocusAllowed) -> PortResult<()> {
    conn.execute("DELETE FROM focus_allowed WHERE session_id = ?1", [session])
        .map_err(port_err)?;
    for app in &allowed.apps {
        conn.execute(
            "INSERT OR IGNORE INTO focus_allowed(session_id, app_id) VALUES (?1, ?2)",
            params![session, app],
        )
        .map_err(port_err)?;
    }
    for activity in &allowed.activities {
        conn.execute(
            "INSERT OR IGNORE INTO focus_allowed(session_id, activity_id) VALUES (?1, ?2)",
            params![session, activity.0],
        )
        .map_err(port_err)?;
    }
    Ok(())
}

fn query(
    conn: &Connection,
    filter: &str,
    args: &[&dyn rusqlite::ToSql],
) -> PortResult<Vec<StoredFocus>> {
    let mut stmt = conn
        .prepare(&format!("SELECT {COLUMNS} FROM focus_sessions {filter}"))
        .map_err(port_err)?;
    let rows = stmt
        .query_map(args, session_from_row)
        .map_err(port_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(port_err)?;
    let mut sessions: Vec<StoredFocus> = rows.into_iter().collect::<PortResult<_>>()?;
    for session in &mut sessions {
        session.allowed = load_allowed(conn, session.id)?;
    }
    Ok(sessions)
}

impl FocusRepository for SqliteFocusRepository {
    fn insert(
        &self,
        intent: &str,
        started_at: UtcMs,
        planned_end: UtcMs,
        allowed: &FocusAllowed,
    ) -> PortResult<i64> {
        let mut conn = lock(&self.conn, "focus")?;
        let tx = conn.transaction().map_err(port_err)?;
        tx.execute(
            "INSERT INTO focus_sessions(intent, started_at, planned_end) VALUES (?1, ?2, ?3)",
            params![intent, started_at.0, planned_end.0],
        )
        .map_err(port_err)?;
        let id = tx.last_insert_rowid();
        save_allowed(&tx, id, allowed)?;
        tx.commit().map_err(port_err)?;
        Ok(id)
    }

    fn update_running(
        &self,
        id: i64,
        planned_end: UtcMs,
        allowed: &FocusAllowed,
        drift_alerts: u32,
    ) -> PortResult<()> {
        let mut conn = lock(&self.conn, "focus")?;
        let tx = conn.transaction().map_err(port_err)?;
        let changed = tx
            .execute(
                "UPDATE focus_sessions SET planned_end = ?2, drift_alerts = ?3
                 WHERE id = ?1 AND ended_at IS NULL",
                params![id, planned_end.0, drift_alerts],
            )
            .map_err(port_err)?;
        if changed == 0 {
            return Err(PortError(format!("no running focus session {id}")));
        }
        save_allowed(&tx, id, allowed)?;
        tx.commit().map_err(port_err)
    }

    fn close(
        &self,
        id: i64,
        ended_at: UtcMs,
        reason: FocusEnd,
        summary: &FocusSummary,
    ) -> PortResult<()> {
        let conn = lock(&self.conn, "focus")?;
        let changed = conn
            .execute(
                "UPDATE focus_sessions
                 SET ended_at = ?2, end_reason = ?3, inside_ms = ?4, outside_ms = ?5,
                     distractions = ?6, seen = 0
                 WHERE id = ?1 AND ended_at IS NULL",
                params![
                    id,
                    ended_at.0,
                    reason.as_str(),
                    summary.inside_ms,
                    summary.outside_ms,
                    distractions_to_json(&summary.top_distractions)
                ],
            )
            .map_err(port_err)?;
        if changed == 0 {
            return Err(PortError(format!("no running focus session {id}")));
        }
        Ok(())
    }

    fn running(&self) -> PortResult<Option<StoredFocus>> {
        let conn = lock(&self.conn, "focus")?;
        Ok(query(&conn, "WHERE ended_at IS NULL LIMIT 1", &[])?
            .into_iter()
            .next())
    }

    fn recent(&self, limit: u32) -> PortResult<Vec<StoredFocus>> {
        let conn = lock(&self.conn, "focus")?;
        query(
            &conn,
            "WHERE ended_at IS NOT NULL ORDER BY started_at DESC, id DESC LIMIT ?1",
            &[&i64::from(limit)],
        )
    }

    fn unseen(&self) -> PortResult<Option<StoredFocus>> {
        let conn = lock(&self.conn, "focus")?;
        Ok(query(
            &conn,
            "WHERE ended_at IS NOT NULL AND seen = 0 ORDER BY ended_at DESC, id DESC LIMIT 1",
            &[],
        )?
        .into_iter()
        .next())
    }

    fn mark_seen(&self, id: i64) -> PortResult<()> {
        let conn = lock(&self.conn, "focus")?;
        conn.execute("UPDATE focus_sessions SET seen = 1 WHERE id = ?1", [id])
            .map(|_| ())
            .map_err(port_err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::open_in_memory;

    fn repo() -> SqliteFocusRepository {
        let conn = open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO activities(id, name, color) VALUES (2, 'Work', '#111')",
            [],
        )
        .unwrap();
        SqliteFocusRepository::new(conn)
    }

    fn allowed() -> FocusAllowed {
        FocusAllowed {
            activities: vec![ActivityId(2)],
            apps: vec!["excel".into(), "word".into()],
        }
    }

    fn summary() -> FocusSummary {
        FocusSummary {
            inside_ms: 2_000,
            outside_ms: 1_000,
            top_distractions: vec![Distraction {
                app_id: "slack".into(),
                app_name: "Slack".into(),
                ms: 700,
            }],
        }
    }

    #[test]
    fn a_running_session_round_trips_with_its_allowed_set() {
        let r = repo();
        let id = r
            .insert("Write report", UtcMs(1_000), UtcMs(9_000), &allowed())
            .unwrap();
        let running = r.running().unwrap().unwrap();
        assert_eq!(running.id, id);
        assert_eq!(running.intent, "Write report");
        assert_eq!(running.allowed, allowed());
        assert_eq!(running.ended_at, None);
        assert_eq!(running.summary, FocusSummary::default());
        assert!(r.recent(10).unwrap().is_empty());
        assert!(r.unseen().unwrap().is_none());
    }

    #[test]
    fn only_one_session_can_run() {
        let r = repo();
        r.insert("a", UtcMs(1), UtcMs(9), &allowed()).unwrap();
        assert!(r.insert("b", UtcMs(2), UtcMs(9), &allowed()).is_err());
    }

    #[test]
    fn updating_changes_the_plan_the_allowed_set_and_the_alert_count() {
        let r = repo();
        let id = r.insert("a", UtcMs(1), UtcMs(9), &allowed()).unwrap();
        let mut more = allowed();
        more.apps.push("slack".into());
        r.update_running(id, UtcMs(20), &more, 3).unwrap();
        let s = r.running().unwrap().unwrap();
        assert_eq!((s.planned_end, s.drift_alerts), (UtcMs(20), 3));
        assert_eq!(s.allowed.apps, ["excel", "slack", "word"]);
        assert!(r.update_running(99, UtcMs(20), &more, 3).is_err());
    }

    #[test]
    fn closing_stores_the_summary_and_waits_for_the_user() {
        let r = repo();
        let id = r.insert("a", UtcMs(1), UtcMs(9), &allowed()).unwrap();
        r.close(id, UtcMs(9), FocusEnd::Completed, &summary())
            .unwrap();
        assert!(r.running().unwrap().is_none());
        let unseen = r.unseen().unwrap().unwrap();
        assert_eq!(unseen.end_reason, Some(FocusEnd::Completed));
        assert_eq!(unseen.summary, summary());
        assert_eq!(unseen.allowed, allowed());
        r.mark_seen(id).unwrap();
        assert!(r.unseen().unwrap().is_none());
        assert_eq!(r.recent(10).unwrap().len(), 1);
        assert!(
            r.close(id, UtcMs(10), FocusEnd::Cancelled, &summary())
                .is_err(),
            "a session closes once"
        );
        // The slot is free again.
        r.insert("b", UtcMs(20), UtcMs(30), &allowed()).unwrap();
    }

    #[test]
    fn history_is_newest_first_and_limited() {
        let r = repo();
        for start in [10, 30, 20] {
            let id = r
                .insert("s", UtcMs(start), UtcMs(start + 5), &allowed())
                .unwrap();
            r.close(id, UtcMs(start + 5), FocusEnd::Cancelled, &summary())
                .unwrap();
        }
        let starts: Vec<i64> = r
            .recent(2)
            .unwrap()
            .iter()
            .map(|s| s.started_at.0)
            .collect();
        assert_eq!(starts, [30, 20]);
    }

    #[test]
    fn deleting_an_activity_drops_it_from_the_allowed_sets() {
        let r = repo();
        let id = r.insert("a", UtcMs(1), UtcMs(9), &allowed()).unwrap();
        {
            let conn = lock(&r.conn, "test").unwrap();
            conn.execute("DELETE FROM activities WHERE id = 2", [])
                .unwrap();
        }
        assert!(r.running().unwrap().unwrap().allowed.activities.is_empty());
        r.close(id, UtcMs(2), FocusEnd::Cancelled, &summary())
            .unwrap();
    }
}
