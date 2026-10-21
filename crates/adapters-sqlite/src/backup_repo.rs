//! Whole-store snapshots for exports and backups, and the atomic full replace of a restore.

use std::path::Path;
use std::sync::Mutex;

use application::backup::{
    ActivityRecord, BackupData, DEVICE_SETTINGS, GapRecord, GoalEventRecord, GoalRecord,
    PrivacyRuleRecord, RuleRecord, SegmentRecord, SettingRecord,
};
use application::ports::{BackupStore, PortError, PortResult};
use domain::UtcMs;
use rusqlite::{Connection, TransactionBehavior, params};

use crate::db::{lock, port_err};

/// The system activity every database keeps (`domain::UNASSIGNED`); the trigger forbids
/// deleting it, so a restore updates it in place.
const SYSTEM_ACTIVITY: i64 = 1;

pub struct SqliteBackupStore {
    conn: Mutex<Connection>,
}

impl SqliteBackupStore {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }
}

impl BackupStore for SqliteBackupStore {
    fn snapshot(&self, range: Option<(UtcMs, UtcMs)>) -> PortResult<BackupData> {
        let mut conn = lock(&self.conn, "backup")?;
        // One read transaction: every table comes from the same point in time.
        let tx = conn.transaction().map_err(port_err)?;
        let (from, to) = range.map_or((i64::MIN, i64::MAX), |(f, t)| (f.0, t.0));
        let data = BackupData {
            activities: read_activities(&tx)?,
            rules: read_rules(&tx)?,
            privacy_rules: read_privacy_rules(&tx)?,
            settings: read_settings(&tx)?,
            segments: read_segments(&tx, from, to)?,
            idle_gaps: read_gaps(&tx, from, to)?,
            goals: read_goals(&tx)?,
            goal_events: read_goal_events(&tx, from, to)?,
        };
        tx.finish().map_err(port_err)?;
        Ok(data)
    }

    fn safety_copy(&self, dest: &Path) -> PortResult<()> {
        let conn = lock(&self.conn, "backup")?;
        conn.execute("VACUUM INTO ?1", [dest.to_string_lossy().as_ref()])
            .map(|_| ())
            .map_err(|e| {
                PortError(format!(
                    "could not copy the database to {}: {e}",
                    dest.display()
                ))
            })
    }

    fn replace_all(&self, data: &BackupData) -> PortResult<()> {
        let mut conn = lock(&self.conn, "backup")?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(port_err)?;
        replace_in(&tx, data)?;
        // Dropping `tx` without commit rolls back, so any error above leaves the data as it was.
        tx.commit().map_err(port_err)
    }
}

fn replace_in(tx: &rusqlite::Transaction<'_>, data: &BackupData) -> PortResult<()> {
    // Goals first: they reference activities (the events go with them).
    for table in [
        "goal_events",
        "goals",
        "segments",
        "idle_gaps",
        "activity_rules",
        "privacy_rules",
    ] {
        tx.execute(&format!("DELETE FROM {table}"), [])
            .map_err(port_err)?;
    }
    tx.execute("DELETE FROM activities WHERE id <> ?1", [SYSTEM_ACTIVITY])
        .map_err(port_err)?;
    let device = DEVICE_SETTINGS
        .iter()
        .map(|k| format!("'{k}'"))
        .collect::<Vec<_>>()
        .join(",");
    tx.execute(
        &format!("DELETE FROM settings WHERE key NOT IN ({device})"),
        [],
    )
    .map_err(port_err)?;

    for a in &data.activities {
        tx.execute(
            "INSERT INTO activities(id, name, color, sort_order, productivity, preset_key)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color,
               sort_order = excluded.sort_order, productivity = excluded.productivity,
               preset_key = excluded.preset_key",
            params![
                a.id,
                a.name,
                a.color,
                a.sort_order,
                a.productivity,
                a.preset_key
            ],
        )
        .map_err(port_err)?;
    }
    for r in &data.rules {
        tx.execute(
            "INSERT INTO activity_rules(id, activity_id, kind, app_id, pattern, priority)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![r.id, r.activity_id, r.kind, r.app_id, r.pattern, r.priority],
        )
        .map_err(port_err)?;
    }
    for p in &data.privacy_rules {
        tx.execute(
            "INSERT INTO privacy_rules(app_id, mode) VALUES (?1, ?2)",
            params![p.app_id, p.mode],
        )
        .map_err(port_err)?;
    }
    for s in data
        .settings
        .iter()
        .filter(|s| !DEVICE_SETTINGS.contains(&s.key.as_str()))
    {
        tx.execute(
            "INSERT INTO settings(key, value) VALUES (?1, ?2)",
            params![s.key, s.value],
        )
        .map_err(port_err)?;
    }
    for g in &data.goals {
        tx.execute(
            "INSERT INTO goals(id, label, scope_kind, activity_id, app_id, period, kind,
               target_ms, active_days, archived, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                g.id,
                g.label,
                g.scope_kind,
                g.activity_id,
                g.app_id,
                g.period,
                g.kind,
                g.target_ms,
                g.active_days,
                g.archived,
                g.created_at
            ],
        )
        .map_err(port_err)?;
    }
    for e in &data.goal_events {
        tx.execute(
            "INSERT INTO goal_events(goal_id, period_start, kind, at, notified, seen)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![e.goal_id, e.period_start, e.kind, e.at, e.notified, e.seen],
        )
        .map_err(port_err)?;
    }
    for s in &data.segments {
        tx.execute(
            "INSERT INTO segments(id, started_at, ended_at, heartbeat_at, app_id, app_name,
               window_title, end_reason, source, activity_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                s.id,
                s.started_at,
                s.ended_at,
                s.heartbeat_at,
                s.app_id,
                s.app_name,
                s.window_title,
                s.end_reason,
                s.source,
                s.activity_id
            ],
        )
        .map_err(port_err)?;
    }
    for g in &data.idle_gaps {
        tx.execute(
            "INSERT INTO idle_gaps(id, started_at, ended_at, prev_app_id, prev_app_name,
               prev_title, status, activity_id, expires_at, resolved_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                g.id,
                g.started_at,
                g.ended_at,
                g.prev_app_id,
                g.prev_app_name,
                g.prev_title,
                g.status,
                g.activity_id,
                g.expires_at,
                g.resolved_at
            ],
        )
        .map_err(port_err)?;
    }
    Ok(())
}

fn read_activities(c: &Connection) -> PortResult<Vec<ActivityRecord>> {
    let mut stmt = c
        .prepare("SELECT id, name, color, sort_order, productivity, preset_key FROM activities ORDER BY id")
        .map_err(port_err)?;
    stmt.query_map([], |r| {
        Ok(ActivityRecord {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
            sort_order: r.get(3)?,
            productivity: r.get(4)?,
            preset_key: r.get(5)?,
        })
    })
    .map_err(port_err)?
    .collect::<Result<_, _>>()
    .map_err(port_err)
}

fn read_rules(c: &Connection) -> PortResult<Vec<RuleRecord>> {
    let mut stmt = c
        .prepare("SELECT id, activity_id, kind, app_id, pattern, priority FROM activity_rules ORDER BY id")
        .map_err(port_err)?;
    stmt.query_map([], |r| {
        Ok(RuleRecord {
            id: r.get(0)?,
            activity_id: r.get(1)?,
            kind: r.get(2)?,
            app_id: r.get(3)?,
            pattern: r.get(4)?,
            priority: r.get(5)?,
        })
    })
    .map_err(port_err)?
    .collect::<Result<_, _>>()
    .map_err(port_err)
}

fn read_privacy_rules(c: &Connection) -> PortResult<Vec<PrivacyRuleRecord>> {
    let mut stmt = c
        .prepare("SELECT app_id, mode FROM privacy_rules ORDER BY app_id")
        .map_err(port_err)?;
    stmt.query_map([], |r| {
        Ok(PrivacyRuleRecord {
            app_id: r.get(0)?,
            mode: r.get(1)?,
        })
    })
    .map_err(port_err)?
    .collect::<Result<_, _>>()
    .map_err(port_err)
}

/// Everything except the settings that belong to this device (see [`DEVICE_SETTINGS`]).
fn read_settings(c: &Connection) -> PortResult<Vec<SettingRecord>> {
    let mut stmt = c
        .prepare("SELECT key, value FROM settings ORDER BY key")
        .map_err(port_err)?;
    let all: Vec<SettingRecord> = stmt
        .query_map([], |r| {
            Ok(SettingRecord {
                key: r.get(0)?,
                value: r.get(1)?,
            })
        })
        .map_err(port_err)?
        .collect::<Result<_, _>>()
        .map_err(port_err)?;
    Ok(all
        .into_iter()
        .filter(|s| !DEVICE_SETTINGS.contains(&s.key.as_str()))
        .collect())
}

fn read_goals(c: &Connection) -> PortResult<Vec<GoalRecord>> {
    let mut stmt = c
        .prepare(
            "SELECT id, label, scope_kind, activity_id, app_id, period, kind, target_ms,
                    active_days, archived, created_at
             FROM goals ORDER BY id",
        )
        .map_err(port_err)?;
    stmt.query_map([], |r| {
        Ok(GoalRecord {
            id: r.get(0)?,
            label: r.get(1)?,
            scope_kind: r.get(2)?,
            activity_id: r.get(3)?,
            app_id: r.get(4)?,
            period: r.get(5)?,
            kind: r.get(6)?,
            target_ms: r.get(7)?,
            active_days: r.get(8)?,
            archived: r.get::<_, i64>(9)? != 0,
            created_at: r.get(10)?,
        })
    })
    .map_err(port_err)?
    .collect::<Result<_, _>>()
    .map_err(port_err)
}

/// Goal events logged in `[from, to)`.
fn read_goal_events(c: &Connection, from: i64, to: i64) -> PortResult<Vec<GoalEventRecord>> {
    let mut stmt = c
        .prepare(
            "SELECT goal_id, period_start, kind, at, notified, seen
             FROM goal_events WHERE at >= ?1 AND at < ?2 ORDER BY at, goal_id, kind",
        )
        .map_err(port_err)?;
    stmt.query_map([from, to], |r| {
        Ok(GoalEventRecord {
            goal_id: r.get(0)?,
            period_start: r.get(1)?,
            kind: r.get(2)?,
            at: r.get(3)?,
            notified: r.get::<_, i64>(4)? != 0,
            seen: r.get::<_, i64>(5)? != 0,
        })
    })
    .map_err(port_err)?
    .collect::<Result<_, _>>()
    .map_err(port_err)
}

/// Segments overlapping `[from, to)`. A segment still open is returned closed at its
/// heartbeat (`recovered`), which is what the app itself would do after a crash.
fn read_segments(c: &Connection, from: i64, to: i64) -> PortResult<Vec<SegmentRecord>> {
    let mut stmt = c
        .prepare(
            "SELECT id, started_at, COALESCE(ended_at, MAX(heartbeat_at, started_at)), heartbeat_at,
                    app_id, app_name, window_title,
                    CASE WHEN ended_at IS NULL THEN 'recovered' ELSE end_reason END,
                    source, activity_id
             FROM segments
             WHERE started_at < ?2 AND (ended_at IS NULL OR ended_at > ?1)
             ORDER BY started_at, id",
        )
        .map_err(port_err)?;
    stmt.query_map([from, to], |r| {
        Ok(SegmentRecord {
            id: r.get(0)?,
            started_at: r.get(1)?,
            ended_at: r.get(2)?,
            heartbeat_at: r.get(3)?,
            app_id: r.get(4)?,
            app_name: r.get(5)?,
            window_title: r.get(6)?,
            end_reason: r.get(7)?,
            source: r.get(8)?,
            activity_id: r.get(9)?,
        })
    })
    .map_err(port_err)?
    .collect::<Result<_, _>>()
    .map_err(port_err)
}

/// Answered gaps that started in `[from, to)`; pending ones still wait for the user.
fn read_gaps(c: &Connection, from: i64, to: i64) -> PortResult<Vec<GapRecord>> {
    let mut stmt = c
        .prepare(
            "SELECT id, started_at, ended_at, prev_app_id, prev_app_name, prev_title, status,
                    activity_id, expires_at, resolved_at
             FROM idle_gaps
             WHERE status <> 'pending' AND started_at >= ?1 AND started_at < ?2
             ORDER BY started_at, id",
        )
        .map_err(port_err)?;
    stmt.query_map([from, to], |r| {
        Ok(GapRecord {
            id: r.get(0)?,
            started_at: r.get(1)?,
            ended_at: r.get(2)?,
            prev_app_id: r.get(3)?,
            prev_app_name: r.get(4)?,
            prev_title: r.get(5)?,
            status: r.get(6)?,
            activity_id: r.get(7)?,
            expires_at: r.get(8)?,
            resolved_at: r.get(9)?,
        })
    })
    .map_err(port_err)?
    .collect::<Result<_, _>>()
    .map_err(port_err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::open;

    fn seeded(path: &Path) -> SqliteBackupStore {
        let conn = open(path).unwrap();
        conn.execute_batch(
            "INSERT INTO activities(id, name, color, sort_order, productivity, preset_key)
               VALUES (2, 'Work', '#111', 1, 'productive', 'dev');
             INSERT INTO activity_rules(id, activity_id, kind, app_id, pattern, priority)
               VALUES (1, 2, 'app', 'com.code', NULL, 0);
             INSERT INTO privacy_rules(app_id, mode) VALUES ('bank', 'exclude');
             INSERT INTO settings(key, value) VALUES ('theme', '\"dark\"'), ('autostart', 'true'),
               ('backup', '{\"dir\":\"/x\"}');
             INSERT INTO segments(id, started_at, ended_at, heartbeat_at, app_id, app_name,
               window_title, end_reason, source, activity_id)
               VALUES (1, 1000, 2000, 2000, 'com.code', 'Code', 'main.rs', 'focus_change', 'tracked', NULL),
                      (2, 5000, 6000, 6000, 'com.mail', 'Mail', 'Inbox', 'idle', 'tracked', 2),
                      (3, 9000, NULL, 9500, 'com.code', 'Code', 'lib.rs', NULL, 'tracked', NULL);
             INSERT INTO idle_gaps(id, started_at, ended_at, prev_app_id, prev_app_name, prev_title,
               status, activity_id, expires_at, resolved_at)
               VALUES (1, 3000, 4000, 'com.code', 'Code', 'main.rs', 'discard', NULL, 9999, 4100),
                      (2, 7000, 8000, NULL, NULL, NULL, 'pending', NULL, 9999, NULL);
             INSERT INTO goals(id, label, scope_kind, activity_id, app_id, period, kind,
               target_ms, active_days, archived, created_at)
               VALUES (1, 'Deep work', 'activity', 2, NULL, 'daily', 'minimum', 7200000, 31, 0, 500),
                      (2, 'Less mail', 'app', NULL, 'com.mail', 'weekly', 'maximum', 3600000, 127, 1, 600);
             INSERT INTO goal_events(goal_id, period_start, kind, at, notified, seen)
               VALUES (1, 19000, 'reached', 2500, 1, 0), (2, 19000, 'exceeded', 6000, 0, 1);",
        )
        .unwrap();
        SqliteBackupStore::new(conn)
    }

    fn fixture() -> (tempfile::TempDir, std::path::PathBuf, SqliteBackupStore) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let store = seeded(&path);
        (dir, path, store)
    }

    #[test]
    fn snapshot_closes_the_open_segment_skips_pending_gaps_and_device_settings() {
        let (_d, _p, store) = fixture();
        let data = store.snapshot(None).unwrap();
        assert_eq!(data.activities.len(), 2);
        assert_eq!(data.segments.len(), 3);
        let open = data.segments.iter().find(|s| s.id == 3).unwrap();
        assert_eq!(open.ended_at, Some(9500));
        assert_eq!(open.end_reason.as_deref(), Some("recovered"));
        assert_eq!(data.idle_gaps.len(), 1);
        assert_eq!((data.goals.len(), data.goal_events.len()), (2, 2));
        assert!(data.goals[1].archived && data.goal_events[0].notified);
        let keys: Vec<&str> = data.settings.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(keys, ["theme"]);
    }

    #[test]
    fn a_range_snapshot_only_has_overlapping_segments_and_gaps_that_started_inside() {
        let (_d, _p, store) = fixture();
        let data = store.snapshot(Some((UtcMs(1500), UtcMs(5500)))).unwrap();
        let ids: Vec<i64> = data.segments.iter().map(|s| s.id).collect();
        assert_eq!(ids, [1, 2]);
        assert_eq!(data.idle_gaps.len(), 1);
        // Goal definitions are not time-bound; their events follow the range.
        assert_eq!((data.goals.len(), data.goal_events.len()), (2, 1));
        let narrow = store.snapshot(Some((UtcMs(0), UtcMs(3000)))).unwrap();
        assert_eq!((narrow.goals.len(), narrow.goal_events.len()), (2, 1));
        assert!(
            store
                .snapshot(Some((UtcMs(2000), UtcMs(3000))))
                .unwrap()
                .segments
                .is_empty()
        );
    }

    #[test]
    fn replace_all_round_trips_a_snapshot_into_another_database() {
        let (_d, _p, store) = fixture();
        let data = store.snapshot(None).unwrap();

        let dir = tempfile::tempdir().unwrap();
        let other_path = dir.path().join("other.db");
        let other = SqliteBackupStore::new(open(&other_path).unwrap());
        // Device settings of the target survive; everything else becomes the snapshot.
        open(&other_path)
            .unwrap()
            .execute_batch(
                "INSERT INTO settings(key, value) VALUES ('shortcut', '\"X\"'), ('stale', '1');
                 INSERT INTO segments(started_at, ended_at, heartbeat_at, app_id, app_name, source)
                   VALUES (1, 2, 2, 'old', 'Old', 'tracked');",
            )
            .unwrap();
        other.replace_all(&data).unwrap();

        let again = other.snapshot(None).unwrap();
        assert_eq!(again.activities, data.activities);
        assert_eq!(again.rules, data.rules);
        assert_eq!(again.privacy_rules, data.privacy_rules);
        assert_eq!(again.segments, data.segments);
        assert_eq!(again.idle_gaps, data.idle_gaps);
        assert_eq!(again.goals, data.goals);
        assert_eq!(again.goal_events, data.goal_events);
        assert_eq!(again.settings, data.settings, "stale setting replaced");
        let conn = open(&other_path).unwrap();
        let shortcut: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'shortcut'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(shortcut, "\"X\"");
        let violations: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(violations, 0);
    }

    #[test]
    fn a_failing_replace_rolls_everything_back() {
        let (_d, path, store) = fixture();
        let before = store.snapshot(None).unwrap();
        let mut broken = before.clone();
        broken.segments.clear();
        // The rule points to an activity the document does not contain.
        broken.activities.retain(|a| a.id == SYSTEM_ACTIVITY);
        assert!(store.replace_all(&broken).is_err());
        assert_eq!(store.snapshot(None).unwrap(), before);
        drop(path);
    }

    #[test]
    fn the_system_activity_is_updated_in_place_and_survives_a_document_without_it() {
        let (_d, _p, store) = fixture();
        let mut data = store.snapshot(None).unwrap();
        data.activities[0].name = "Sin asignar".into();
        data.activities[0].color = "#000".into();
        store.replace_all(&data).unwrap();
        assert_eq!(
            store.snapshot(None).unwrap().activities[0].name,
            "Sin asignar"
        );

        let empty = BackupData::default();
        store.replace_all(&empty).unwrap();
        let after = store.snapshot(None).unwrap();
        assert_eq!(after.activities.len(), 1, "id 1 cannot be deleted");
        assert!(after.segments.is_empty() && after.rules.is_empty());
    }

    #[test]
    fn the_safety_copy_is_a_complete_database_and_refuses_to_overwrite() {
        let (dir, _p, store) = fixture();
        let copy = dir.path().join("t.db.pre-restore-1");
        store.safety_copy(&copy).unwrap();
        let conn = Connection::open(&copy).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM segments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 3);
        assert!(store.safety_copy(&copy).is_err());
    }
}
