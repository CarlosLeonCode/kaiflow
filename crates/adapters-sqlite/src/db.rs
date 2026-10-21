//! Connection setup: PRAGMAs, then migrations (design section 7).

use std::fmt;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use application::ports::PortError;
use rusqlite::Connection;

use crate::migrations::{MIGRATIONS, migrate};

#[derive(Debug)]
pub enum DbError {
    Sqlite(rusqlite::Error),
    Io(std::io::Error),
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DbError::Sqlite(e) => write!(f, "sqlite: {e}"),
            DbError::Io(e) => write!(f, "io: {e}"),
        }
    }
}

impl std::error::Error for DbError {}

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError::Sqlite(e)
    }
}

impl From<std::io::Error> for DbError {
    fn from(e: std::io::Error) -> Self {
        DbError::Io(e)
    }
}

pub(crate) fn port_err(e: rusqlite::Error) -> PortError {
    PortError(e.to_string())
}

/// Locks a shared connection, turning poisoning into a port error.
pub(crate) fn lock<'a>(
    conn: &'a Mutex<Connection>,
    what: &str,
) -> Result<MutexGuard<'a, Connection>, PortError> {
    conn.lock()
        .map_err(|_| PortError(format!("{what} connection poisoned")))
}

fn apply_pragmas(conn: &Connection) -> Result<(), DbError> {
    // `journal_mode` returns a row; in-memory databases answer "memory", which is fine.
    conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

/// Opens (creating parent directories if needed) and migrates the database at `path`.
/// Existing databases are copied to `<name>.bak-v<N>` before any migration runs.
pub fn open(path: &Path) -> Result<Connection, DbError> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    let mut conn = Connection::open(path)?;
    apply_pragmas(&conn)?;
    migrate(&mut conn, MIGRATIONS, Some(path))?;
    Ok(conn)
}

/// A fresh, fully migrated in-memory database (tests and ephemeral use).
pub fn open_in_memory() -> Result<Connection, DbError> {
    let mut conn = Connection::open_in_memory()?;
    apply_pragmas(&conn)?;
    migrate(&mut conn, MIGRATIONS, None)?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations::{backup_path, current_version};

    #[test]
    fn open_creates_directories_and_enables_pragmas() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/app/timetrack.db");
        let conn = open(&path).unwrap();
        assert_eq!(current_version(&conn).unwrap(), 2);
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fk, 1);
    }

    #[test]
    fn reopening_an_up_to_date_database_makes_no_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("timetrack.db");
        drop(open(&path).unwrap());
        drop(open(&path).unwrap());
        assert!(!backup_path(&path, 2).exists());
    }
}
