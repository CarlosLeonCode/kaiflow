//! Migration 0007 (progress): the strokes ledger and the seals table are added next to the
//! existing data, and their constraints hold.

use adapters_sqlite::migrations::{MIGRATIONS, backup_path, current_version, migrate};
use rusqlite::Connection;

#[test]
fn an_existing_v6_database_gets_the_progress_tables_and_keeps_its_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("kaiflow.db");
    let mut conn = Connection::open(&path).unwrap();
    migrate(&mut conn, &MIGRATIONS[..6], Some(&path)).unwrap();
    assert_eq!(current_version(&conn).unwrap(), 6);
    conn.execute(
        "INSERT INTO focus_sessions(id, intent, started_at, planned_end, ended_at, end_reason, kind)
         VALUES (1, 'Write', 1, 5, 5, 'completed', 'focus')",
        [],
    )
    .unwrap();

    migrate(&mut conn, MIGRATIONS, Some(&path)).unwrap();

    assert_eq!(current_version(&conn).unwrap(), 7);
    assert!(backup_path(&path, 6).exists());
    let count = |table: &str| -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    };
    assert_eq!(count("focus_sessions"), 1);
    assert_eq!(count("stroke_awards"), 0);
    assert_eq!(count("seals"), 0);
}

#[test]
fn the_progress_tables_are_checked() {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate(&mut conn, MIGRATIONS, None).unwrap();
    let award = |key: &str, strokes: i64| {
        conn.execute(
            "INSERT INTO stroke_awards(award_key, day, source, strokes, earned_at)
             VALUES (?1, 3, 'focus_completed', ?2, 20)",
            rusqlite::params![key, strokes],
        )
    };
    assert!(award("focus_completed:1", 10).is_ok());
    assert!(award("focus_completed:1", 10).is_err(), "keys are unique");
    assert!(award("focus_completed:2", -1).is_err(), "never negative");
    assert!(
        award("focus_completed:2", 0).is_ok(),
        "a full day still logs"
    );

    let seal = |name: &str, seen: i64| {
        conn.execute(
            "INSERT INTO seals(seal, earned_at, seen) VALUES (?1, 1, ?2)",
            rusqlite::params![name, seen],
        )
    };
    assert!(seal("first_focus", 0).is_ok());
    assert!(seal("first_focus", 0).is_err(), "earned once");
    assert!(seal("seven_days", 2).is_err());
}
