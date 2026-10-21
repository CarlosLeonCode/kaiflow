//! Migration 0003 (goals): the schema accepts valid goals and rejects incoherent ones, events
//! dedupe per goal, period and kind, and an existing v2 database keeps its data.

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

const GOAL: &str = "INSERT INTO goals(id, label, scope_kind, activity_id, app_id, period, kind, target_ms, created_at)";

#[test]
fn an_existing_v2_database_keeps_its_data_and_gets_a_backup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("kaiflow.db");
    let mut conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "foreign_keys", true).unwrap();
    migrate(&mut conn, &MIGRATIONS[..2], Some(&path)).unwrap();
    conn.execute_batch(
        "INSERT INTO activities(id, name, color, sort_order) VALUES (2, 'Work', '#111', 1);
         INSERT INTO settings(key, value) VALUES ('theme', '\"dark\"');",
    )
    .unwrap();
    assert_eq!(current_version(&conn).unwrap(), 2);

    migrate(&mut conn, MIGRATIONS, Some(&path)).unwrap();

    assert_eq!(
        current_version(&conn).unwrap(),
        MIGRATIONS.last().unwrap().version
    );
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM activities"), 2);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM settings"), 1);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM goals"), 0);
    assert!(backup_path(&path, 2).exists());
    let violations: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(violations, 0);
}

#[test]
fn goals_must_match_their_scope() {
    let conn = fresh();
    conn.execute_batch("INSERT INTO activities(id, name, color) VALUES (2, 'Work', '#111');")
        .unwrap();
    let ok = [
        format!("{GOAL} VALUES (1, 'a', 'activity', 2, NULL, 'daily', 'minimum', 1000, 0)"),
        format!("{GOAL} VALUES (2, 'b', 'app', NULL, 'com.mail', 'weekly', 'maximum', 1000, 0)"),
        format!("{GOAL} VALUES (3, 'c', 'total', NULL, NULL, 'monthly', 'minimum', 1000, 0)"),
    ];
    for sql in ok {
        conn.execute(&sql, []).unwrap();
    }
    let bad = [
        // activity scope without an activity, app scope with both, total with an app.
        format!("{GOAL} VALUES (4, 'x', 'activity', NULL, NULL, 'daily', 'minimum', 1000, 0)"),
        format!("{GOAL} VALUES (5, 'x', 'app', 2, 'com.mail', 'daily', 'minimum', 1000, 0)"),
        format!("{GOAL} VALUES (6, 'x', 'total', NULL, 'com.mail', 'daily', 'minimum', 1000, 0)"),
        // Unknown period / kind, a zero target and an unknown activity.
        format!("{GOAL} VALUES (7, 'x', 'total', NULL, NULL, 'hourly', 'minimum', 1000, 0)"),
        format!("{GOAL} VALUES (8, 'x', 'total', NULL, NULL, 'daily', 'sometimes', 1000, 0)"),
        format!("{GOAL} VALUES (9, 'x', 'total', NULL, NULL, 'daily', 'minimum', 0, 0)"),
        format!("{GOAL} VALUES (10, 'x', 'activity', 99, NULL, 'daily', 'minimum', 1000, 0)"),
    ];
    for sql in bad {
        assert!(conn.execute(&sql, []).is_err(), "accepted: {sql}");
    }
    assert!(
        conn.execute("UPDATE goals SET active_days = 0 WHERE id = 1", [])
            .is_err()
    );
    assert!(
        conn.execute("UPDATE goals SET active_days = 128 WHERE id = 1", [])
            .is_err()
    );
}

#[test]
fn events_are_unique_per_goal_period_and_kind_and_follow_their_goal() {
    let conn = fresh();
    conn.execute(
        &format!("{GOAL} VALUES (1, 'a', 'total', NULL, NULL, 'daily', 'maximum', 1000, 0)"),
        [],
    )
    .unwrap();
    let insert =
        "INSERT OR IGNORE INTO goal_events(goal_id, period_start, kind, at) VALUES (1, ?1, ?2, 5)";
    assert_eq!(conn.execute(insert, (100, "exceeded")).unwrap(), 1);
    assert_eq!(
        conn.execute(insert, (100, "exceeded")).unwrap(),
        0,
        "once per period"
    );
    assert_eq!(
        conn.execute(insert, (101, "exceeded")).unwrap(),
        1,
        "a new period fires again"
    );
    assert_eq!(conn.execute(insert, (100, "reached")).unwrap(), 1);
    assert!(
        conn.execute(
            "INSERT INTO goal_events(goal_id, period_start, kind, at) VALUES (1, 100, 'other', 5)",
            []
        )
        .is_err()
    );
    assert!(
        conn.execute(
            "INSERT INTO goal_events(goal_id, period_start, kind, at) VALUES (9, 100, 'reached', 5)",
            []
        )
        .is_err(),
        "an event needs an existing goal"
    );
    conn.execute("DELETE FROM goals WHERE id = 1", []).unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM goal_events"), 0);
}

#[test]
fn deleting_an_activity_deletes_its_goals() {
    let conn = fresh();
    conn.execute_batch("INSERT INTO activities(id, name, color) VALUES (2, 'Work', '#111');")
        .unwrap();
    conn.execute(
        &format!("{GOAL} VALUES (1, 'a', 'activity', 2, NULL, 'daily', 'minimum', 1000, 0)"),
        [],
    )
    .unwrap();
    conn.execute("DELETE FROM activities WHERE id = 2", [])
        .unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM goals"), 0);
}
