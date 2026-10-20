use std::sync::Mutex;

use application::ports::{PortError, PortResult, PrivacyMode, PrivacyRepository};
use domain::PrivacyPolicy;
use rusqlite::{Connection, OptionalExtension, params};

use crate::db::{lock, port_err};

/// Settings key of the single global title switch (design section 7).
const STORE_TITLES_KEY: &str = "store_titles";

/// Per-app exclusion / title redaction. The global `store_titles` switch is read from
/// the settings table, which stays the only place that writes it.
pub struct SqlitePrivacyRepository {
    conn: Mutex<Connection>,
}

impl SqlitePrivacyRepository {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }
}

impl PrivacyRepository for SqlitePrivacyRepository {
    fn load_policy(&self) -> PortResult<PrivacyPolicy> {
        let conn = lock(&self.conn, "privacy")?;
        let raw: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [STORE_TITLES_KEY],
                |r| r.get(0),
            )
            .optional()
            .map_err(port_err)?;
        let mut policy = PrivacyPolicy {
            // Titles are stored unless the user switched them off (S2).
            store_titles: match raw.as_deref() {
                None | Some("true") => true,
                Some("false") => false,
                Some(other) => {
                    return Err(PortError(format!("invalid store_titles setting: {other}")));
                }
            },
            ..PrivacyPolicy::default()
        };
        let mut stmt = conn
            .prepare("SELECT app_id, mode FROM privacy_rules")
            .map_err(port_err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(port_err)?;
        for row in rows {
            let (app_id, mode) = row.map_err(port_err)?;
            match mode.as_str() {
                "exclude" => policy.excluded_apps.insert(app_id),
                "redact_title" => policy.redacted_apps.insert(app_id),
                other => return Err(PortError(format!("invalid privacy mode: {other}"))),
            };
        }
        Ok(policy)
    }

    fn set_mode(&self, app_id: &str, mode: Option<PrivacyMode>) -> PortResult<()> {
        let conn = lock(&self.conn, "privacy")?;
        match mode {
            None => conn
                .execute("DELETE FROM privacy_rules WHERE app_id = ?1", [app_id])
                .map(|_| ()),
            Some(mode) => conn
                .execute(
                    "INSERT INTO privacy_rules(app_id, mode) VALUES (?1, ?2)
                     ON CONFLICT(app_id) DO UPDATE SET mode = excluded.mode",
                    params![
                        app_id,
                        match mode {
                            PrivacyMode::Exclude => "exclude",
                            PrivacyMode::RedactTitle => "redact_title",
                        }
                    ],
                )
                .map(|_| ()),
        }
        .map_err(port_err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SqliteSettingsRepository;
    use crate::db::open_in_memory;
    use application::ports::SettingsRepository;

    fn repo() -> SqlitePrivacyRepository {
        SqlitePrivacyRepository::new(open_in_memory().unwrap())
    }

    #[test]
    fn defaults_to_storing_titles_with_no_rules() {
        assert_eq!(repo().load_policy().unwrap(), PrivacyPolicy::default());
    }

    #[test]
    fn modes_are_exclusive_per_app_and_removable() {
        let r = repo();
        r.set_mode("a", Some(PrivacyMode::Exclude)).unwrap();
        r.set_mode("b", Some(PrivacyMode::RedactTitle)).unwrap();
        let p = r.load_policy().unwrap();
        assert!(p.excluded_apps.contains("a") && p.redacted_apps.contains("b"));

        r.set_mode("a", Some(PrivacyMode::RedactTitle)).unwrap();
        let p = r.load_policy().unwrap();
        assert!(p.excluded_apps.is_empty() && p.redacted_apps.len() == 2);

        r.set_mode("a", None).unwrap();
        r.set_mode("missing", None).unwrap();
        let p = r.load_policy().unwrap();
        assert!(!p.redacted_apps.contains("a") && p.redacted_apps.contains("b"));
    }

    #[test]
    fn global_switch_comes_from_the_settings_table() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let settings = SqliteSettingsRepository::new(crate::db::open(&path).unwrap());
        let privacy = SqlitePrivacyRepository::new(crate::db::open(&path).unwrap());
        settings.set("store_titles", "false").unwrap();
        assert!(!privacy.load_policy().unwrap().store_titles);
        settings.set("store_titles", "true").unwrap();
        assert!(privacy.load_policy().unwrap().store_titles);
        settings.set("store_titles", "\"nope\"").unwrap();
        assert!(privacy.load_policy().is_err());
    }
}
