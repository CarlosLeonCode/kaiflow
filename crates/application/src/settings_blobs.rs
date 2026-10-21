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

/// Key of the [`BackupSettings`] blob.
pub const KEY_BACKUP: &str = "backup";

/// Key of the [`SuggestionSettings`] blob.
pub const KEY_SUGGESTIONS: &str = "suggestions";

/// Flat setting holding the first day of the week (0 = Monday .. 6 = Sunday).
pub const KEY_WEEK_START: &str = "week_start";

/// The configured first day of the week; Monday when unset or out of range.
pub fn read_week_start(repo: &dyn SettingsRepository) -> PortResult<u8> {
    match repo.get(KEY_WEEK_START)? {
        None => Ok(0),
        Some(raw) => raw
            .trim()
            .parse::<u8>()
            .map(|v| if v < 7 { v } else { 0 })
            .map_err(|_| PortError(format!("invalid value for setting {KEY_WEEK_START}: {raw}"))),
    }
}

/// Flat setting holding how long (seconds) the user may be outside a focus session's allowed
/// set before a drift alert.
pub const KEY_FOCUS_DRIFT_AFTER: &str = "focus_drift_after_secs";
pub const DEFAULT_FOCUS_DRIFT_AFTER_SECS: u32 = 90;
pub const FOCUS_DRIFT_AFTER_RANGE_SECS: std::ops::RangeInclusive<u32> = 30..=900;

/// The configured drift threshold in seconds; the default when unset.
pub fn read_focus_drift_after_secs(repo: &dyn SettingsRepository) -> PortResult<u32> {
    match repo.get(KEY_FOCUS_DRIFT_AFTER)? {
        None => Ok(DEFAULT_FOCUS_DRIFT_AFTER_SECS),
        Some(raw) => raw
            .trim()
            .parse::<u32>()
            .map(|v| {
                v.clamp(
                    *FOCUS_DRIFT_AFTER_RANGE_SECS.start(),
                    *FOCUS_DRIFT_AFTER_RANGE_SECS.end(),
                )
            })
            .map_err(|_| {
                PortError(format!(
                    "invalid value for setting {KEY_FOCUS_DRIFT_AFTER}: {raw}"
                ))
            }),
    }
}

/// Key of the [`FocusTimerSettings`] blob.
pub const KEY_FOCUS_TIMER: &str = "focus_timer";

/// Key of the pomodoro cycle state (not a user setting: where the cycle stands, so a restart
/// resumes it).
pub const KEY_FOCUS_CYCLE: &str = "focus_cycle";

/// The pomodoro cycle, alerts and sound of focus blocks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(default)]
pub struct FocusTimerSettings {
    /// Offer a break after each work block, and a long one every few.
    pub cycle_enabled: bool,
    pub short_break_minutes: u32,
    pub long_break_minutes: u32,
    /// Work blocks before a long break.
    pub long_break_every: u32,
    /// Start what comes next without asking.
    pub auto_start_next: bool,
    /// Sound with the end-of-block alert (notification and popover chime).
    pub sound: bool,
    /// A notification one minute before a block ends.
    pub heads_up: bool,
}

impl Default for FocusTimerSettings {
    fn default() -> Self {
        Self {
            cycle_enabled: true,
            short_break_minutes: 5,
            long_break_minutes: 15,
            long_break_every: 4,
            auto_start_next: false,
            sound: true,
            heads_up: false,
        }
    }
}

impl FocusTimerSettings {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=60).contains(&self.short_break_minutes) {
            return Err("a short break lasts between 1 and 60 minutes".into());
        }
        if !(1..=120).contains(&self.long_break_minutes) {
            return Err("a long break lasts between 1 and 120 minutes".into());
        }
        if !(1..=12).contains(&self.long_break_every) {
            return Err("a long break comes after 1 to 12 work blocks".into());
        }
        Ok(())
    }

    /// The cycle rules these settings describe.
    pub fn cycle(&self) -> domain::focus_cycle::CycleConfig {
        domain::focus_cycle::CycleConfig {
            enabled: self.cycle_enabled,
            short_break_ms: i64::from(self.short_break_minutes.clamp(1, 60)) * 60_000,
            long_break_ms: i64::from(self.long_break_minutes.clamp(1, 120)) * 60_000,
            long_every: self.long_break_every.clamp(1, 12),
        }
    }
}

/// Most dismissed apps remembered; the oldest fall off first.
pub const MAX_DISMISSED_APPS: usize = 500;

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

/// App suggestions the user declined; they never come back.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(default)]
pub struct SuggestionSettings {
    pub dismissed_apps: Vec<String>,
}

impl SuggestionSettings {
    /// Records a dismissal (once), dropping the oldest ones beyond the cap.
    pub fn dismiss(&mut self, app_id: &str) {
        if self.dismissed_apps.iter().any(|a| a == app_id) {
            return;
        }
        self.dismissed_apps.push(app_id.to_owned());
        let excess = self.dismissed_apps.len().saturating_sub(MAX_DISMISSED_APPS);
        self.dismissed_apps.drain(..excess);
    }
}

/// Daily backup configuration and the outcome of the last run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(default)]
pub struct BackupSettings {
    /// On by default (the user can switch it off).
    pub enabled: bool,
    /// Custom folder; `None` means the default folder inside the app data directory.
    pub dir: Option<String>,
    /// UTC ms of the last successful backup.
    pub last_backup_at: Option<i64>,
    /// Message of the last failed run; cleared by the next success.
    pub last_error: Option<String>,
    /// Whether the current failure streak was already announced (the notice shows once).
    pub failure_notified: bool,
}

impl Default for BackupSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            dir: None,
            last_backup_at: None,
            last_error: None,
            failure_notified: false,
        }
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
    fn backups_are_on_by_default_and_tolerate_partial_blobs() {
        let repo = FakeSettings::default();
        let fresh: BackupSettings = read_blob(&repo, KEY_BACKUP).unwrap();
        assert!(fresh.enabled && fresh.dir.is_none() && fresh.last_backup_at.is_none());
        repo.set(KEY_BACKUP, r#"{"dir":"/tmp/x"}"#).unwrap();
        let partial: BackupSettings = read_blob(&repo, KEY_BACKUP).unwrap();
        assert!(partial.enabled, "a missing field keeps its default");
        assert_eq!(partial.dir.as_deref(), Some("/tmp/x"));
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

    #[test]
    fn dismissals_are_unique_and_capped() {
        let mut s = SuggestionSettings::default();
        s.dismiss("a");
        s.dismiss("a");
        assert_eq!(s.dismissed_apps, ["a"]);
        for i in 0..(MAX_DISMISSED_APPS + 5) {
            s.dismiss(&format!("app{i}"));
        }
        assert_eq!(s.dismissed_apps.len(), MAX_DISMISSED_APPS);
        assert_eq!(s.dismissed_apps.last().unwrap(), "app504");
        assert!(!s.dismissed_apps.contains(&"a".to_owned()));
    }
}
