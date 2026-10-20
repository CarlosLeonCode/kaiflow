use std::sync::Mutex;

use application::ports::{PortError, PortResult, SettingsRepository};
use rusqlite::{Connection, OptionalExtension, params};

use crate::db::port_err;

/// Key/value settings; values are JSON text (design section 7).
pub struct SqliteSettingsRepository {
    conn: Mutex<Connection>,
}

impl SqliteSettingsRepository {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }
}

impl SettingsRepository for SqliteSettingsRepository {
    fn get(&self, key: &str) -> PortResult<Option<String>> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| PortError("settings connection poisoned".into()))?;
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()
        .map_err(port_err)
    }

    fn set(&self, key: &str, value: &str) -> PortResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| PortError("settings connection poisoned".into()))?;
        conn.execute(
            "INSERT INTO settings(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map(|_| ())
        .map_err(port_err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn missing_key_is_none_and_set_overwrites() {
        let repo = SqliteSettingsRepository::new(open_in_memory().unwrap());
        assert_eq!(repo.get("theme").unwrap(), None);
        repo.set("theme", "\"dark\"").unwrap();
        assert_eq!(repo.get("theme").unwrap().as_deref(), Some("\"dark\""));
        repo.set("theme", "\"light\"").unwrap();
        assert_eq!(repo.get("theme").unwrap().as_deref(), Some("\"light\""));
    }

    #[test]
    fn settings_persist_across_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        SqliteSettingsRepository::new(crate::db::open(&path).unwrap())
            .set("idle_threshold_secs", "300")
            .unwrap();
        let again = SqliteSettingsRepository::new(crate::db::open(&path).unwrap());
        assert_eq!(
            again.get("idle_threshold_secs").unwrap().as_deref(),
            Some("300")
        );
    }
}
