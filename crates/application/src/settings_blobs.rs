//! Typed JSON blobs stored in the flat `settings` table, one blob per feature.
//!
//! Older flat keys (`theme`, `idle_threshold_secs`, ...) stay as they are; settings of newer
//! features live in one JSON document each, so adding a field never touches a migration:
//! every blob struct is `#[serde(default)]` and unknown fields are ignored on read.

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::ports::{PortError, PortResult, SettingsRepository};

/// Key of the [`UiSettings`] blob.
pub const KEY_UI: &str = "ui";

/// Most intros the blob may remember (there is one per dashboard section).
const MAX_DISMISSED_INTROS: usize = 64;
const MAX_INTRO_ID_LEN: usize = 64;

/// Reads blob `key`; a missing key yields `T::default()`, a corrupt one is an error.
pub fn read_blob<T: DeserializeOwned + Default>(
    repo: &dyn SettingsRepository,
    key: &str,
) -> PortResult<T> {
    match repo.get(key)? {
        None => Ok(T::default()),
        Some(raw) => serde_json::from_str(&raw)
            .map_err(|e| PortError(format!("invalid value for setting {key}: {e}"))),
    }
}

/// Replaces the whole blob stored under `key`.
pub fn write_blob<T: Serialize>(
    repo: &dyn SettingsRepository,
    key: &str,
    value: &T,
) -> PortResult<()> {
    let raw = serde_json::to_string(value)
        .map_err(|e| PortError(format!("cannot encode setting {key}: {e}")))?;
    repo.set(key, &raw)
}

/// Interface state that must survive a restart.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(default)]
pub struct UiSettings {
    /// Ids of the section intros the user dismissed (e.g. `"today"`).
    pub dismissed_intros: Vec<String>,
}

impl UiSettings {
    /// Rejects blobs that are oversized or contain blank ids.
    pub fn validate(&self) -> Result<(), String> {
        if self.dismissed_intros.len() > MAX_DISMISSED_INTROS {
            return Err("too many dismissed intros".into());
        }
        if self
            .dismissed_intros
            .iter()
            .any(|id| id.trim().is_empty() || id.len() > MAX_INTRO_ID_LEN)
        {
            return Err("intro ids must be 1 to 64 characters".into());
        }
        Ok(())
    }

    /// Same ids, first occurrence order, without duplicates.
    pub fn normalized(mut self) -> Self {
        let mut seen = std::collections::HashSet::new();
        self.dismissed_intros.retain(|id| seen.insert(id.clone()));
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fakes::FakeSettings;

    #[test]
    fn missing_blob_is_the_default() {
        let repo = FakeSettings::default();
        let ui: UiSettings = read_blob(&repo, KEY_UI).unwrap();
        assert_eq!(ui, UiSettings::default());
    }

    #[test]
    fn blob_round_trips_and_ignores_unknown_fields() {
        let repo = FakeSettings::default();
        let ui = UiSettings {
            dismissed_intros: vec!["today".into(), "activities".into()],
        };
        write_blob(&repo, KEY_UI, &ui).unwrap();
        assert_eq!(read_blob::<UiSettings>(&repo, KEY_UI).unwrap(), ui);

        repo.set(KEY_UI, r#"{"dismissed_intros":["x"],"future_field":1}"#)
            .unwrap();
        assert_eq!(
            read_blob::<UiSettings>(&repo, KEY_UI)
                .unwrap()
                .dismissed_intros,
            ["x"]
        );
        repo.set(KEY_UI, "{}").unwrap();
        assert_eq!(
            read_blob::<UiSettings>(&repo, KEY_UI).unwrap(),
            UiSettings::default(),
            "missing fields take defaults"
        );
    }

    #[test]
    fn corrupt_blob_is_an_error() {
        let repo = FakeSettings::default();
        repo.set(KEY_UI, "not json").unwrap();
        assert!(read_blob::<UiSettings>(&repo, KEY_UI).is_err());
    }

    #[test]
    fn validation_and_normalization() {
        let blank = UiSettings {
            dismissed_intros: vec![" ".into()],
        };
        assert!(blank.validate().is_err());
        let many = UiSettings {
            dismissed_intros: (0..65).map(|i| i.to_string()).collect(),
        };
        assert!(many.validate().is_err());
        let dup = UiSettings {
            dismissed_intros: vec!["a".into(), "b".into(), "a".into()],
        };
        assert_eq!(dup.normalized().dismissed_intros, ["a", "b"]);
    }
}
