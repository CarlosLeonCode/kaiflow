//! Migration 0002 (categories -> activities) against a real v1 database with data.
//!
//! The v1 schema is created by the shipped 0001 migration; rows are inserted with the v1
//! column names, then the full migration list runs exactly as `open()` does at startup.

use std::path::Path;

use adapters_sqlite::SqliteActivityRepository;
use adapters_sqlite::migrations::{MIGRATIONS, Migration, backup_path, current_version, migrate};
use application::ports::ActivityRepository;
use domain::{ActivityId, Productivity, Segment, SegmentId, SegmentSource, UNASSIGNED, UtcMs};
use rusqlite::Connection;

fn open_raw(path: &Path) -> Connection {
    let conn = Connection::open(path).unwrap();
    // Same pragmas as `adapters_sqlite::open`.
    conn.pragma_update(None, "foreign_keys", true).unwrap();
    conn
}

/// A v1 database with 3 activities (1 = system), 2 rules, tracked and activity-only segments,
/// and idle gaps in several statuses, one of them `assign_category`.
fn v1_database(path: &Path) -> Connection {
    let mut conn = open_raw(path);
    migrate(&mut conn, &MIGRATIONS[..1], Some(path)).unwrap();
    assert_eq!(current_version(&conn).unwrap(), 1);
    conn.execute_batch(
        "INSERT INTO categories(id, name, color, sort_order) VALUES (2, 'Work', '#00ff00', 1);
         INSERT INTO categories(id, name, color, sort_order) VALUES (3, 'Chat', '#0000ff', 2);
         INSERT INTO category_rules(id, category_id, kind, app_id, pattern, priority)
           VALUES (1, 3, 'app', 'slack', NULL, 0);
         INSERT INTO category_rules(id, category_id, kind, app_id, pattern, priority)
           VALUES (2, 2, 'title', NULL, 'invoice', 4);
         -- tracked, rule-classified
         INSERT INTO segments(id, started_at, ended_at, heartbeat_at, app_id, app_name,
                              window_title, end_reason, source, category_id)
           VALUES (1, 1000, 2000, 2000, 'slack', 'Slack', 'general', 'focus_change',
                   'tracked', NULL);
         -- tracked, manually assigned
         INSERT INTO segments(id, started_at, ended_at, heartbeat_at, app_id, app_name,
                              window_title, end_reason, source, category_id)
           VALUES (2, 2000, 3000, 3000, 'code', 'Code', 'main.rs', 'focus_change',
                   'tracked', 2);
         -- idle time assigned straight to an activity (no app)
         INSERT INTO segments(id, started_at, ended_at, heartbeat_at, app_id, app_name,
                              window_title, end_reason, source, category_id)
           VALUES (3, 3000, 4000, 4000, NULL, NULL, NULL, 'idle', 'idle_assigned', 3);
         INSERT INTO idle_gaps(id, started_at, ended_at, status, category_id, expires_at,
                               resolved_at)
           VALUES (1, 3000, 4000, 'assign_category', 3, 9000, 4000);
         INSERT INTO idle_gaps(id, started_at, ended_at, prev_app_id, status, category_id,
                               expires_at)
           VALUES (2, 5000, 6000, 'slack', 'pending', NULL, 9000);
         INSERT INTO idle_gaps(id, started_at, ended_at, status, category_id, expires_at,
                               resolved_at)
           VALUES (3, 6000, 7000, 'discard', NULL, 9000, 7000);",
    )
    .unwrap();
    conn
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn table_exists(conn: &Connection, name: &str) -> bool {
    count(
        conn,
        &format!("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{name}'"),
    ) > 0
}

#[test]
fn migration_keeps_a_v1_backup_and_all_rows_as_neutral_activities() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("kaiflow.db");
    let mut conn = v1_database(&path);

    migrate(&mut conn, MIGRATIONS, Some(&path)).unwrap();

    // `VACUUM INTO` copy, still v1 and untouched.
    let backup = backup_path(&path, 1);
    assert!(backup.ends_with("kaiflow.db.bak-v1"));
    let copy = Connection::open(&backup).unwrap();
    assert_eq!(current_version(&copy).unwrap(), 1);
    assert_eq!(count(&copy, "SELECT COUNT(*) FROM categories"), 3);
    assert_eq!(count(&copy, "SELECT COUNT(*) FROM category_rules"), 2);
    assert_eq!(count(&copy, "SELECT COUNT(*) FROM segments"), 3);
    assert!(!table_exists(&copy, "activities"));

    // Migrated database.
    assert_eq!(
        current_version(&conn).unwrap(),
        MIGRATIONS.last().unwrap().version
    );
    assert!(!table_exists(&conn, "categories"));
    assert!(!table_exists(&conn, "category_rules"));
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM activities"), 3);
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM activities WHERE productivity = 'neutral' AND preset_key IS NULL"
        ),
        3
    );
    let names: Vec<String> = conn
        .prepare("SELECT name FROM activities ORDER BY id")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(names, ["Unassigned", "Work", "Chat"]);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM activity_rules"), 2);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM segments"), 3);

    // The foreign-key graph is intact and the file is healthy.
    let violations: i64 = conn
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query_map([], |_| Ok(()))
        .unwrap()
        .count() as i64;
    assert_eq!(violations, 0);
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
}

#[test]
fn rename_column_rewrites_check_and_foreign_keys() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("kaiflow.db");
    let mut conn = v1_database(&path);
    migrate(&mut conn, MIGRATIONS, Some(&path)).unwrap();

    // No stored schema statement may still reference the old names. (SQLite keeps the original
    // text of `--` comments inside `sql`, so those are ignored.)
    let leftovers: Vec<String> = conn
        .prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL")
        .unwrap()
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .filter(|(_, sql)| {
            sql.lines()
                .filter(|l| !l.trim_start().starts_with("--"))
                .any(|l| l.to_lowercase().contains("categor"))
        })
        .map(|(name, _)| name)
        .collect();
    assert!(leftovers.is_empty(), "stale schema objects: {leftovers:?}");

    // CHECK on segments now reads `activity_id`: an activity-only idle segment needs one.
    let no_owner = conn.execute(
        "INSERT INTO segments(started_at, ended_at, heartbeat_at, end_reason, source, activity_id)
         VALUES (10, 20, 20, 'idle', 'idle_assigned', NULL)",
        [],
    );
    assert!(
        no_owner.is_err(),
        "CHECK must reject an owner-less idle segment"
    );
    conn.execute(
        "INSERT INTO segments(started_at, ended_at, heartbeat_at, end_reason, source, activity_id)
         VALUES (10, 20, 20, 'idle', 'idle_assigned', 2)",
        [],
    )
    .unwrap();

    // FK on segments.activity_id -> activities(id).
    let dangling = conn.execute(
        "INSERT INTO segments(started_at, ended_at, heartbeat_at, app_id, end_reason, source,
                              activity_id)
         VALUES (30, 40, 40, 'x', 'stop', 'tracked', 999)",
        [],
    );
    assert!(dangling.is_err(), "FK must reject an unknown activity");

    // FK on activity_rules.activity_id -> activities(id).
    let dangling_rule = conn.execute(
        "INSERT INTO activity_rules(activity_id, kind, app_id, priority)
         VALUES (999, 'app', 'x', 0)",
        [],
    );
    assert!(dangling_rule.is_err());

    // ON DELETE CASCADE / SET NULL still fire through the rewritten references.
    conn.execute("DELETE FROM segments WHERE id IN (3, 4)", [])
        .unwrap();
    conn.execute("UPDATE idle_gaps SET activity_id = NULL WHERE id = 1", [])
        .unwrap();
    conn.execute("DELETE FROM activities WHERE id = 3", [])
        .unwrap();
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM activity_rules WHERE activity_id = 3"
        ),
        0,
        "rules cascade"
    );
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM segments WHERE activity_id = 3"),
        0
    );
    conn.execute("UPDATE idle_gaps SET activity_id = 2 WHERE id = 1", [])
        .unwrap();
    conn.execute(
        "UPDATE segments SET activity_id = 1 WHERE activity_id = 2",
        [],
    )
    .unwrap();
    conn.execute("DELETE FROM activities WHERE id = 2", [])
        .unwrap();
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM idle_gaps WHERE id = 1 AND activity_id IS NULL"
        ),
        1,
        "idle_gaps.activity_id is SET NULL on delete"
    );
}

#[test]
fn idle_gaps_are_rebuilt_with_the_new_status_literal() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("kaiflow.db");
    let mut conn = v1_database(&path);
    migrate(&mut conn, MIGRATIONS, Some(&path)).unwrap();

    let statuses: Vec<(i64, String, Option<i64>)> = conn
        .prepare("SELECT id, status, activity_id FROM idle_gaps ORDER BY id")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(
        statuses,
        [
            (1, "assign_activity".to_owned(), Some(3)),
            (2, "pending".to_owned(), None),
            (3, "discard".to_owned(), None),
        ]
    );
    let resolved: i64 = conn
        .query_row("SELECT resolved_at FROM idle_gaps WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(resolved, 4000);

    let insert = |status: &str| {
        conn.execute(
            "INSERT INTO idle_gaps(started_at, ended_at, status, expires_at) VALUES (1, 2, ?1, 3)",
            [status],
        )
    };
    assert!(
        insert("assign_category").is_err(),
        "old literal is rejected"
    );
    assert!(insert("assign_activity").is_ok());
}

#[test]
fn existing_rules_classify_segments_exactly_as_before() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("kaiflow.db");
    let mut conn = v1_database(&path);
    migrate(&mut conn, MIGRATIONS, Some(&path)).unwrap();
    drop(conn);

    let repo = SqliteActivityRepository::new(open_raw(&path));
    let rules = repo.list_rules().unwrap();
    assert_eq!(rules.len(), 2);

    let segment = |app: &str, title: &str, manual: Option<i64>| Segment {
        id: SegmentId(1),
        started_at: UtcMs(0),
        ended_at: Some(UtcMs(1)),
        heartbeat_at: UtcMs(1),
        app_id: Some(app.into()),
        app_name: Some(app.into()),
        window_title: Some(title.into()),
        end_reason: None,
        source: SegmentSource::Tracked,
        activity_id: manual.map(ActivityId),
    };
    // App rule -> Chat (3), title rule -> Work (2), manual beats rules, otherwise unassigned.
    assert_eq!(
        domain::classify(&segment("slack", "general", None), &rules),
        ActivityId(3)
    );
    assert_eq!(
        domain::classify(&segment("slack", "invoice 42", None), &rules),
        ActivityId(2)
    );
    assert_eq!(
        domain::classify(&segment("code", "x", Some(3)), &rules),
        ActivityId(3)
    );
    assert_eq!(
        domain::classify(&segment("other", "x", None), &rules),
        UNASSIGNED
    );

    let listed = repo.list().unwrap();
    assert!(
        listed
            .iter()
            .all(|a| a.productivity == Productivity::Neutral)
    );
}

#[test]
fn system_trigger_is_recreated_and_still_protects_id_1() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("kaiflow.db");
    let mut conn = v1_database(&path);
    migrate(&mut conn, MIGRATIONS, Some(&path)).unwrap();

    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'
             AND name='trg_activities_protect_system'"
        ),
        1
    );
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'
             AND name='trg_categories_protect_system'"
        ),
        0
    );
    assert!(
        conn.execute("DELETE FROM activities WHERE id = 1", [])
            .is_err()
    );
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM activities WHERE id = 1"),
        1
    );
    // And the new index exists.
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='ix_seg_end'"
        ),
        1
    );
}

#[test]
fn system_row_is_renamed_only_when_it_still_has_the_default_name() {
    // A user-renamed system row keeps its name.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("kaiflow.db");
    let mut conn = v1_database(&path);
    conn.execute("UPDATE categories SET name = 'Inbox' WHERE id = 1", [])
        .unwrap();
    migrate(&mut conn, MIGRATIONS, Some(&path)).unwrap();
    let name: String = conn
        .query_row("SELECT name FROM activities WHERE id = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(name, "Inbox");

    // A name collision keeps the default name instead of failing the migration.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("kaiflow.db");
    let mut conn = v1_database(&path);
    conn.execute("UPDATE categories SET name = 'Unassigned' WHERE id = 2", [])
        .unwrap();
    migrate(&mut conn, MIGRATIONS, Some(&path)).unwrap();
    let name: String = conn
        .query_row("SELECT name FROM activities WHERE id = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(name, "Sin categoría");
}

#[test]
fn failed_0002_leaves_the_v1_database_intact() {
    // The real 0002 followed by a statement that fails: everything must roll back.
    const BROKEN_0002: Migration = Migration {
        version: 2,
        sql: concat!(
            include_str!("../migrations/0002_activities.sql"),
            "\nINSERT INTO no_such_table VALUES (1);"
        ),
    };
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("kaiflow.db");
    let mut conn = v1_database(&path);

    assert!(migrate(&mut conn, &[MIGRATIONS[0], BROKEN_0002], Some(&path)).is_err());

    assert_eq!(current_version(&conn).unwrap(), 1);
    assert!(table_exists(&conn, "categories"));
    assert!(table_exists(&conn, "category_rules"));
    assert!(!table_exists(&conn, "activities"));
    assert!(!table_exists(&conn, "idle_gaps_new"));
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM categories"), 3);
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM idle_gaps WHERE status='assign_category'"
        ),
        1
    );
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE name='trg_categories_protect_system'"
        ),
        1,
        "the dropped v1 trigger comes back with the rollback"
    );
    assert!(backup_path(&path, 1).exists());

    // A later healthy run still succeeds from the intact v1 state.
    migrate(&mut conn, MIGRATIONS, Some(&path)).unwrap();
    assert_eq!(
        current_version(&conn).unwrap(),
        MIGRATIONS.last().unwrap().version
    );
}
