//! Migration 0005 (AI reviews): the schema accepts valid reviews and rejects incoherent ones,
//! and an existing v4 database keeps its data.

use adapters_sqlite::migrations::{MIGRATIONS, backup_path, current_version, migrate};
use rusqlite::Connection;

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

const INSERT: &str =
    "INSERT INTO ai_reviews(period_start, period_end, period_label, provider, model,
    included_titles, request_json, response_json, status, created_at)";

#[test]
fn an_existing_v4_database_keeps_its_data_and_gets_a_backup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("kaiflow.db");
    let mut conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "foreign_keys", true).unwrap();
    migrate(&mut conn, &MIGRATIONS[..4], Some(&path)).unwrap();
    conn.execute_batch(
        "INSERT INTO activities(id, name, color, sort_order) VALUES (2, 'Work', '#111', 1);
         INSERT INTO focus_sessions(id, intent, started_at, planned_end) VALUES (1, 'Write', 1, 5);
         INSERT INTO settings(key, value) VALUES ('theme', '\"dark\"');",
    )
    .unwrap();
    assert_eq!(current_version(&conn).unwrap(), 4);

    migrate(&mut conn, MIGRATIONS, Some(&path)).unwrap();

    assert_eq!(current_version(&conn).unwrap(), 5);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM activities"), 2);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM focus_sessions"), 1);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM ai_reviews"), 0);
    assert!(backup_path(&path, 4).exists());
    let violations: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(violations, 0);
}

#[test]
fn reviews_must_be_coherent() {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate(&mut conn, MIGRATIONS, None).unwrap();
    let ok = [
        format!(
            "{INSERT} VALUES (1, 8, 'a', 'anthropic', 'claude-haiku-5-5', 0, '{{}}', '{{}}', 'ok', 9)"
        ),
        format!(
            "{INSERT} VALUES (1, 8, 'a', 'gemini', 'g', 1, '{{}}', '{{\"text\":\"x\"}}', 'text_fallback', 9)"
        ),
        format!("{INSERT} VALUES (1, 8, 'a', 'openai', 'o', 0, '{{}}', '{{}}', 'ok', 9)"),
        format!("{INSERT} VALUES (1, 8, 'a', 'ollama', 'llama', 0, '{{}}', '{{}}', 'ok', 9)"),
    ];
    for sql in &ok {
        conn.execute(sql, []).unwrap();
    }
    let bad = [
        // Unknown provider.
        format!("{INSERT} VALUES (1, 8, 'a', 'other', 'm', 0, '{{}}', '{{}}', 'ok', 9)"),
        // Unknown status.
        format!("{INSERT} VALUES (1, 8, 'a', 'ollama', 'm', 0, '{{}}', '{{}}', 'partial', 9)"),
        // Period ends before it starts.
        format!("{INSERT} VALUES (8, 8, 'a', 'ollama', 'm', 0, '{{}}', '{{}}', 'ok', 9)"),
        // Empty model.
        format!("{INSERT} VALUES (1, 8, 'a', 'ollama', '', 0, '{{}}', '{{}}', 'ok', 9)"),
        // Titles flag is a boolean.
        format!("{INSERT} VALUES (1, 8, 'a', 'ollama', 'm', 2, '{{}}', '{{}}', 'ok', 9)"),
    ];
    for sql in &bad {
        assert!(conn.execute(sql, []).is_err(), "{sql}");
    }
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM ai_reviews"), 4);
}

#[test]
fn there_is_no_column_for_a_secret() {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate(&mut conn, MIGRATIONS, None).unwrap();
    let columns: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('ai_reviews')")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert!(
        columns
            .iter()
            .all(|c| !c.contains("key") && !c.contains("secret") && !c.contains("token")),
        "{columns:?}"
    );
}
