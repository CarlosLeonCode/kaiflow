//! Migration 0004 (focus sessions): the schema accepts valid sessions and rejects incoherent
//! ones, allows a single running session, and an existing v3 database keeps its data.

use adapters_sqlite::migrations::{MIGRATIONS, backup_path, current_version, migrate};
use rusqlite::Connection;

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn fresh() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", true).unwrap();
    migrate(&mut conn, MIGRATIONS, None).unwrap();
    conn
}

const RUNNING: &str = "INSERT INTO focus_sessions(id, intent, started_at, planned_end)";
const CLOSED: &str =
    "INSERT INTO focus_sessions(id, intent, started_at, planned_end, ended_at, end_reason)";

#[test]
fn an_existing_v3_database_keeps_its_data_and_gets_a_backup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("kaiflow.db");
    let mut conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "foreign_keys", true).unwrap();
    migrate(&mut conn, &MIGRATIONS[..3], Some(&path)).unwrap();
    conn.execute_batch(
        "INSERT INTO activities(id, name, color, sort_order) VALUES (2, 'Work', '#111', 1);
         INSERT INTO goals(id, label, scope_kind, period, kind, target_ms, created_at)
           VALUES (1, 'Any', 'total', 'daily', 'minimum', 1000, 0);
         INSERT INTO settings(key, value) VALUES ('theme', '\"dark\"');",
    )
    .unwrap();
    assert_eq!(current_version(&conn).unwrap(), 3);

    migrate(&mut conn, MIGRATIONS, Some(&path)).unwrap();

    assert_eq!(
        current_version(&conn).unwrap(),
        MIGRATIONS.last().unwrap().version
    );
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM activities"), 2);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM goals"), 1);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM focus_sessions"), 0);
    assert!(backup_path(&path, 3).exists());
    let violations: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(violations, 0);
}

#[test]
fn sessions_must_be_coherent() {
    let conn = fresh();
    let ok = [
        format!("{RUNNING} VALUES (1, 'Write report', 100, 200)"),
        format!("{CLOSED} VALUES (2, 'Done', 100, 200, 150, 'completed')"),
        format!("{CLOSED} VALUES (3, 'Stopped', 100, 200, 120, 'cancelled')"),
        format!("{CLOSED} VALUES (4, 'Found over', 100, 200, 200, 'recovered')"),
    ];
    // Only one session may run: the first insert is the running one.
    conn.execute(&ok[0], []).unwrap();
    for sql in &ok[1..] {
        conn.execute(sql, []).unwrap();
    }
    let bad = [
        // Empty and over-long intents.
        format!("{CLOSED} VALUES (10, '', 100, 200, 150, 'completed')"),
        format!(
            "{CLOSED} VALUES (11, '{}', 100, 200, 150, 'completed')",
            "x".repeat(81)
        ),
        // Planned end not after the start; ended before it started.
        format!("{CLOSED} VALUES (12, 'a', 100, 100, 100, 'completed')"),
        format!("{CLOSED} VALUES (13, 'a', 100, 200, 99, 'completed')"),
        // An end without a reason, a reason without an end, an unknown reason.
        "INSERT INTO focus_sessions(id, intent, started_at, planned_end, ended_at)
         VALUES (14, 'a', 100, 200, 150)"
            .to_owned(),
        format!("{CLOSED} VALUES (15, 'a', 100, 200, NULL, 'completed')"),
        format!("{CLOSED} VALUES (16, 'a', 100, 200, 150, 'tracking_stopped')"),
    ];
    for sql in bad {
        assert!(conn.execute(&sql, []).is_err(), "accepted: {sql}");
    }
    assert!(
        conn.execute(
            "UPDATE focus_sessions SET drift_alerts = -1 WHERE id = 2",
            []
        )
        .is_err()
    );
}

#[test]
fn only_one_session_can_run_and_a_closed_one_frees_the_slot() {
    let conn = fresh();
    conn.execute(&format!("{RUNNING} VALUES (1, 'a', 100, 200)"), [])
        .unwrap();
    assert!(
        conn.execute(&format!("{RUNNING} VALUES (2, 'b', 110, 210)"), [])
            .is_err()
    );
    conn.execute(
        "UPDATE focus_sessions SET ended_at = 150, end_reason = 'cancelled' WHERE id = 1",
        [],
    )
    .unwrap();
    conn.execute(&format!("{RUNNING} VALUES (2, 'b', 160, 260)"), [])
        .unwrap();
}

#[test]
fn allowed_entries_are_an_app_or_an_activity_and_follow_their_owners() {
    let conn = fresh();
    conn.execute_batch(
        "INSERT INTO activities(id, name, color) VALUES (2, 'Work', '#111');
         INSERT INTO focus_sessions(id, intent, started_at, planned_end) VALUES (1, 'a', 100, 200);",
    )
    .unwrap();
    let insert = "INSERT INTO focus_allowed(session_id, app_id, activity_id) VALUES (?1, ?2, ?3)";
    conn.execute(insert, (1, Some("excel"), None::<i64>))
        .unwrap();
    conn.execute(insert, (1, None::<&str>, Some(2))).unwrap();
    // Neither, both, a duplicate, an unknown session and an unknown activity.
    assert!(
        conn.execute(insert, (1, None::<&str>, None::<i64>))
            .is_err()
    );
    assert!(conn.execute(insert, (1, Some("x"), Some(2))).is_err());
    assert!(
        conn.execute(insert, (1, Some("excel"), None::<i64>))
            .is_err()
    );
    assert!(conn.execute(insert, (1, None::<&str>, Some(2))).is_err());
    assert!(conn.execute(insert, (9, Some("x"), None::<i64>)).is_err());
    assert!(conn.execute(insert, (1, None::<&str>, Some(99))).is_err());

    // Deleting an activity removes it from the allowed sets; deleting the session, all of them.
    conn.execute("DELETE FROM activities WHERE id = 2", [])
        .unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM focus_allowed"), 1);
    conn.execute("DELETE FROM focus_sessions WHERE id = 1", [])
        .unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM focus_allowed"), 0);
}
