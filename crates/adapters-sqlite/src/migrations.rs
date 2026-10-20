//! Forward-only migrations tracked with `PRAGMA user_version` (R4.1).

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::db::DbError;

#[derive(Debug, Clone, Copy)]
pub struct Migration {
    /// Target `user_version` after this migration; must be strictly increasing from 1.
    pub version: u32,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    sql: include_str!("../migrations/0001_init.sql"),
}];

pub fn current_version(conn: &Connection) -> Result<u32, DbError> {
    Ok(conn.pragma_query_value(None, "user_version", |row| row.get(0))?)
}

/// Where the pre-migration copy of a database at `from_version` lives.
pub fn backup_path(db_path: &Path, from_version: u32) -> PathBuf {
    let mut name = db_path.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".bak-v{from_version}"));
    db_path.with_file_name(name)
}

/// Applies every pending migration, one transaction each.
///
/// With `backup_to_dir_of = Some(db_path)` and an existing schema (version > 0), the database
/// is first copied with `VACUUM INTO` (never overwriting an earlier backup of that version).
/// A failing migration rolls back, leaving the previous schema, data and version intact.
pub fn migrate(
    conn: &mut Connection,
    migrations: &[Migration],
    backup_to_dir_of: Option<&Path>,
) -> Result<(), DbError> {
    let from = current_version(conn)?;
    let pending: Vec<&Migration> = migrations.iter().filter(|m| m.version > from).collect();
    if pending.is_empty() {
        return Ok(());
    }
    if let Some(db_path) = backup_to_dir_of.filter(|_| from > 0) {
        let target = backup_path(db_path, from);
        if !target.exists() {
            // VACUUM cannot run inside a transaction; the target must not exist.
            conn.execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()])?;
        }
    }
    for migration in pending {
        let tx = conn.transaction()?;
        tx.execute_batch(migration.sql)?;
        // `user_version` is part of the transaction, so a rollback restores it.
        tx.pragma_update(None, "user_version", migration.version)?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table_exists(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [name],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            > 0
    }

    #[test]
    fn fresh_database_gets_full_schema_and_system_category() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn, MIGRATIONS, None).unwrap();
        assert_eq!(current_version(&conn).unwrap(), 1);
        for t in [
            "categories",
            "segments",
            "idle_gaps",
            "category_rules",
            "privacy_rules",
            "settings",
        ] {
            assert!(table_exists(&conn, t), "missing table {t}");
        }
        let name: String = conn
            .query_row("SELECT name FROM categories WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "Sin categoría");
        for idx in ["ix_seg_start", "ix_seg_app_start", "ux_one_open"] {
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
                    [idx],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "missing index {idx}");
        }
    }

    #[test]
    fn migrating_twice_is_a_no_op() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn, MIGRATIONS, None).unwrap();
        migrate(&mut conn, MIGRATIONS, None).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn system_category_cannot_be_deleted() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn, MIGRATIONS, None).unwrap();
        assert!(
            conn.execute("DELETE FROM categories WHERE id = 1", [])
                .is_err()
        );
    }

    const V2_OK: Migration = Migration {
        version: 2,
        sql: "CREATE TABLE extra(x INTEGER);",
    };
    // The first statement succeeds, the second fails: the whole migration must roll back.
    const V3_BROKEN: Migration = Migration {
        version: 3,
        sql: "CREATE TABLE half_done(x INTEGER); INSERT INTO no_such_table VALUES (1);",
    };

    #[test]
    fn backup_is_created_before_migrating_an_existing_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("timetrack.db");
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn, MIGRATIONS, Some(&path)).unwrap();
        assert!(
            !backup_path(&path, 0).exists(),
            "fresh DB has nothing to back up"
        );
        conn.execute("INSERT INTO settings(key, value) VALUES ('k', '1')", [])
            .unwrap();

        migrate(&mut conn, &[MIGRATIONS[0], V2_OK], Some(&path)).unwrap();

        let backup = backup_path(&path, 1);
        assert!(backup.exists());
        assert_eq!(current_version(&conn).unwrap(), 2);
        let copy = Connection::open(&backup).unwrap();
        assert_eq!(current_version(&copy).unwrap(), 1);
        assert!(!table_exists(&copy, "extra"));
        let kept: String = copy
            .query_row("SELECT value FROM settings WHERE key='k'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(kept, "1");
    }

    #[test]
    fn failed_migration_keeps_previous_schema_data_and_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("timetrack.db");
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn, MIGRATIONS, Some(&path)).unwrap();
        conn.execute("INSERT INTO settings(key, value) VALUES ('k', '1')", [])
            .unwrap();

        let all = [MIGRATIONS[0], V2_OK, V3_BROKEN];
        assert!(migrate(&mut conn, &all, Some(&path)).is_err());

        // v2 committed on its own; v3 rolled back completely.
        assert_eq!(current_version(&conn).unwrap(), 2);
        assert!(table_exists(&conn, "extra"));
        assert!(!table_exists(&conn, "half_done"));
        assert!(backup_path(&path, 1).exists());
        let kept: String = conn
            .query_row("SELECT value FROM settings WHERE key='k'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(kept, "1");
        drop(conn);

        // Reopening through the public entry point surfaces the failure and keeps the file usable.
        let reopened = Connection::open(&path).unwrap();
        assert_eq!(current_version(&reopened).unwrap(), 2);
    }
}
