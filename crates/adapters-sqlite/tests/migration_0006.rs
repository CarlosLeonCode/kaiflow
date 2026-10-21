//! Migration 0006 (focus timer): existing sessions become focus blocks that were never paused,
//! and the new columns reject incoherent values.

use adapters_sqlite::migrations::{MIGRATIONS, backup_path, current_version, migrate};
use rusqlite::Connection;

#[test]
fn an_existing_v5_database_keeps_its_sessions_as_focus_blocks() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("kaiflow.db");
    let mut conn = Connection::open(&path).unwrap();
    migrate(&mut conn, &MIGRATIONS[..5], Some(&path)).unwrap();
    conn.execute_batch(
        "INSERT INTO focus_sessions(id, intent, started_at, planned_end, ended_at, end_reason)
           VALUES (1, 'Write', 1, 5, 5, 'completed');
         INSERT INTO focus_sessions(id, intent, started_at, planned_end) VALUES (2, 'Read', 10, 50);",
    )
    .unwrap();

    migrate(&mut conn, MIGRATIONS, Some(&path)).unwrap();

    assert_eq!(current_version(&conn).unwrap(), 6);
    assert!(backup_path(&path, 5).exists());
    let rows: Vec<(String, i64, Option<i64>, i64)> = conn
        .prepare("SELECT kind, untitled, paused_at, paused_ms FROM focus_sessions ORDER BY id")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(
        rows,
        vec![
            ("focus".to_owned(), 0, None, 0),
            ("focus".to_owned(), 0, None, 0)
        ]
    );
}

#[test]
fn the_new_columns_are_checked() {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate(&mut conn, MIGRATIONS, None).unwrap();
    let insert = |kind: &str, untitled: i64, paused_ms: i64| {
        conn.execute(
            "INSERT INTO focus_sessions(intent, started_at, planned_end, kind, untitled, paused_ms)
             VALUES ('x', 1, 5, ?1, ?2, ?3)",
            rusqlite::params![kind, untitled, paused_ms],
        )
    };
    assert!(insert("nap", 0, 0).is_err());
    assert!(insert("timer", 2, 0).is_err());
    assert!(insert("timer", 0, -1).is_err());
    assert!(insert("break", 1, 10).is_ok());
}
