//! The versioned JSON document shared by "Export JSON", the daily backup and restore.
//!
//! Records mirror the stored rows (ids included) so a restore reproduces the data exactly.
//! The format is additive: readers ignore unknown fields and `schema_version` only grows on
//! incompatible changes. API keys and the backup folder never appear in it.

use std::io::{Read, Write};

use domain::UtcMs;
use domain::backup_retention::civil_from_days;
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use serde::{Deserialize, Serialize};

use crate::settings_blobs::KEY_BACKUP;

/// Value of `format`.
pub const FORMAT: &str = "timetrack";
/// Highest `schema_version` this build writes and understands.
pub const SCHEMA_VERSION: u32 = 1;
/// Largest uncompressed document accepted on restore (zip-bomb guard).
pub const MAX_DOCUMENT_BYTES: u64 = 512 * 1024 * 1024;
const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];

/// Settings that belong to this device rather than to the data: never exported with the
/// document's settings and never overwritten by a restore.
pub const DEVICE_SETTINGS: [&str; 4] =
    ["autostart", "shortcut", "onboarding_completed", KEY_BACKUP];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Backup,
    Export,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActivityRecord {
    pub id: i64,
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub sort_order: i64,
    /// `productive`, `neutral` or `distracting`.
    #[serde(default = "neutral")]
    pub productivity: String,
    #[serde(default)]
    pub preset_key: Option<String>,
}

fn neutral() -> String {
    "neutral".into()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleRecord {
    pub id: i64,
    pub activity_id: i64,
    /// `app` or `title`.
    pub kind: String,
    #[serde(default)]
    pub app_id: Option<String>,
    #[serde(default)]
    pub pattern: Option<String>,
    #[serde(default)]
    pub priority: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrivacyRuleRecord {
    pub app_id: String,
    /// `exclude` or `redact_title`.
    pub mode: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SettingRecord {
    pub key: String,
    /// JSON text, as stored.
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SegmentRecord {
    pub id: i64,
    pub started_at: i64,
    /// Always set in a document: a segment that was still open is closed at its heartbeat.
    #[serde(default)]
    pub ended_at: Option<i64>,
    pub heartbeat_at: i64,
    #[serde(default)]
    pub app_id: Option<String>,
    #[serde(default)]
    pub app_name: Option<String>,
    #[serde(default)]
    pub window_title: Option<String>,
    #[serde(default)]
    pub end_reason: Option<String>,
    /// `tracked` or `idle_assigned`.
    pub source: String,
    #[serde(default)]
    pub activity_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GapRecord {
    pub id: i64,
    pub started_at: i64,
    pub ended_at: i64,
    #[serde(default)]
    pub prev_app_id: Option<String>,
    #[serde(default)]
    pub prev_app_name: Option<String>,
    #[serde(default)]
    pub prev_title: Option<String>,
    pub status: String,
    #[serde(default)]
    pub activity_id: Option<i64>,
    pub expires_at: i64,
    #[serde(default)]
    pub resolved_at: Option<i64>,
}

/// The data a snapshot carries and a restore replaces.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct BackupData {
    pub activities: Vec<ActivityRecord>,
    pub rules: Vec<RuleRecord>,
    pub privacy_rules: Vec<PrivacyRuleRecord>,
    pub settings: Vec<SettingRecord>,
    pub segments: Vec<SegmentRecord>,
    pub idle_gaps: Vec<GapRecord>,
}

impl BackupData {
    /// Drops every window title (segments and idle gaps), for users who do not store them.
    pub fn strip_titles(&mut self) {
        for segment in &mut self.segments {
            segment.window_title = None;
        }
        for gap in &mut self.idle_gaps {
            gap.prev_title = None;
        }
    }
}

/// UTC range `[from, to)` an export covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RangeDoc {
    pub from: i64,
    pub to: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Document {
    pub format: String,
    pub kind: Kind,
    pub schema_version: u32,
    pub app_version: String,
    /// ISO 8601, UTC.
    pub exported_at: String,
    /// Local offset when the document was written, e.g. `UTC+02:00`.
    pub timezone: String,
    pub range: Option<RangeDoc>,
    #[serde(flatten)]
    pub data: BackupData,
    /// Reserved for later features; empty today and tolerated by every reader.
    #[serde(default)]
    pub goals: Vec<serde_json::Value>,
    #[serde(default)]
    pub focus_sessions: Vec<serde_json::Value>,
    #[serde(default)]
    pub ai_reviews: Vec<serde_json::Value>,
}

/// Why a file cannot be read as a Time Track document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocumentError {
    NotJson(String),
    NotATimeTrackFile,
    /// Written by a newer app version.
    FutureVersion(u32),
    TooLarge,
    Inconsistent(String),
}

impl std::fmt::Display for DocumentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotJson(e) => write!(f, "the file is not a valid backup or export: {e}"),
            Self::NotATimeTrackFile => f.write_str("the file is not a Time Track backup or export"),
            Self::FutureVersion(v) => write!(
                f,
                "the file uses format version {v}, which this app version cannot read; update the app first"
            ),
            Self::TooLarge => f.write_str("the file is too large to restore"),
            Self::Inconsistent(m) => write!(f, "the file is inconsistent: {m}"),
        }
    }
}

impl Document {
    pub fn new(
        kind: Kind,
        app_version: &str,
        now: UtcMs,
        timezone: &str,
        range: Option<(UtcMs, UtcMs)>,
        data: BackupData,
    ) -> Self {
        Self {
            format: FORMAT.into(),
            kind,
            schema_version: SCHEMA_VERSION,
            app_version: app_version.into(),
            exported_at: iso_utc(now),
            timezone: timezone.into(),
            range: range.map(|(from, to)| RangeDoc {
                from: from.0,
                to: to.0,
            }),
            data,
            goals: Vec::new(),
            focus_sessions: Vec::new(),
            ai_reviews: Vec::new(),
        }
    }

    pub fn to_json(&self) -> Vec<u8> {
        // Serializing plain data structures cannot fail.
        serde_json::to_vec_pretty(self).unwrap_or_default()
    }

    pub fn to_gzip(&self) -> Vec<u8> {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        let _ = encoder.write_all(&self.to_json());
        encoder.finish().unwrap_or_default()
    }

    /// Reads plain or gzipped JSON, checks format and version, and makes the data safe to
    /// restore (open segments closed, references resolvable).
    pub fn parse(bytes: &[u8]) -> Result<Self, DocumentError> {
        let json = if bytes.starts_with(&GZIP_MAGIC) {
            let mut out = Vec::new();
            // One extra byte tells "exactly at the limit" from "over it".
            GzDecoder::new(bytes)
                .take(MAX_DOCUMENT_BYTES + 1)
                .read_to_end(&mut out)
                .map_err(|e| DocumentError::NotJson(e.to_string()))?;
            if out.len() as u64 > MAX_DOCUMENT_BYTES {
                return Err(DocumentError::TooLarge);
            }
            out
        } else {
            bytes.to_vec()
        };
        let value: serde_json::Value =
            serde_json::from_slice(&json).map_err(|e| DocumentError::NotJson(e.to_string()))?;
        if value.get("format").and_then(|f| f.as_str()) != Some(FORMAT) {
            return Err(DocumentError::NotATimeTrackFile);
        }
        // Checked before the full parse so a future file never fails on its new fields.
        let version = value
            .get("schema_version")
            .and_then(serde_json::Value::as_u64)
            .ok_or(DocumentError::NotATimeTrackFile)?;
        let version = u32::try_from(version).unwrap_or(u32::MAX);
        if version > SCHEMA_VERSION {
            return Err(DocumentError::FutureVersion(version));
        }
        if version == 0 {
            return Err(DocumentError::NotATimeTrackFile);
        }
        let mut doc: Document =
            serde_json::from_value(value).map_err(|e| DocumentError::NotJson(e.to_string()))?;
        doc.normalize()?;
        Ok(doc)
    }

    fn normalize(&mut self) -> Result<(), DocumentError> {
        let bad = |m: &str| Err(DocumentError::Inconsistent(m.into()));
        let ids: std::collections::HashSet<i64> =
            self.data.activities.iter().map(|a| a.id).collect();
        if ids.len() != self.data.activities.len() {
            return bad("duplicate activity ids");
        }
        let mut names = std::collections::HashSet::new();
        if !self.data.activities.iter().all(|a| names.insert(&a.name)) {
            return bad("duplicate activity names");
        }
        let known = |id: i64| ids.contains(&id);
        if self.data.rules.iter().any(|r| !known(r.activity_id)) {
            return bad("a rule points to an unknown activity");
        }
        if self
            .data
            .segments
            .iter()
            .any(|s| s.activity_id.is_some_and(|id| !known(id)))
        {
            return bad("a segment points to an unknown activity");
        }
        if self
            .data
            .idle_gaps
            .iter()
            .any(|g| g.activity_id.is_some_and(|id| !known(id)))
        {
            return bad("an idle gap points to an unknown activity");
        }
        // Only one open segment can exist; documents close them, but never trust a file.
        for segment in &mut self.data.segments {
            if segment.ended_at.is_none() {
                segment.ended_at = Some(segment.heartbeat_at.max(segment.started_at));
                segment.end_reason.get_or_insert_with(|| "recovered".into());
            }
        }
        Ok(())
    }
}

/// Numbers a restore preview shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Summary {
    pub kind: Kind,
    pub app_version: String,
    pub exported_at: String,
    pub activities: usize,
    pub rules: usize,
    pub segments: usize,
    pub idle_gaps: usize,
    /// First start and last end among the segments (UTC ms).
    pub first_at: Option<i64>,
    pub last_at: Option<i64>,
}

impl Document {
    pub fn summary(&self) -> Summary {
        let segments = &self.data.segments;
        Summary {
            kind: self.kind,
            app_version: self.app_version.clone(),
            exported_at: self.exported_at.clone(),
            activities: self.data.activities.len(),
            rules: self.data.rules.len(),
            segments: segments.len(),
            idle_gaps: self.data.idle_gaps.len(),
            first_at: segments.iter().map(|s| s.started_at).min(),
            last_at: segments
                .iter()
                .map(|s| s.ended_at.unwrap_or(s.heartbeat_at))
                .max(),
        }
    }
}

/// `YYYY-MM-DDTHH:MM:SSZ`.
pub fn iso_utc(t: UtcMs) -> String {
    let secs = t.0.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        tod / 3_600,
        tod % 3_600 / 60,
        tod % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data() -> BackupData {
        BackupData {
            activities: vec![
                ActivityRecord {
                    id: 1,
                    name: "Unassigned".into(),
                    color: "#999".into(),
                    sort_order: 0,
                    productivity: "neutral".into(),
                    preset_key: None,
                },
                ActivityRecord {
                    id: 2,
                    name: "Work".into(),
                    color: "#111".into(),
                    sort_order: 1,
                    productivity: "productive".into(),
                    preset_key: Some("dev".into()),
                },
            ],
            rules: vec![RuleRecord {
                id: 1,
                activity_id: 2,
                kind: "app".into(),
                app_id: Some("com.code".into()),
                pattern: None,
                priority: 0,
            }],
            privacy_rules: vec![PrivacyRuleRecord {
                app_id: "bank".into(),
                mode: "exclude".into(),
            }],
            settings: vec![SettingRecord {
                key: "theme".into(),
                value: "\"dark\"".into(),
            }],
            segments: vec![SegmentRecord {
                id: 7,
                started_at: 1_000,
                ended_at: Some(5_000),
                heartbeat_at: 5_000,
                app_id: Some("com.code".into()),
                app_name: Some("Code".into()),
                window_title: Some("main.rs".into()),
                end_reason: Some("focus_change".into()),
                source: "tracked".into(),
                activity_id: None,
            }],
            idle_gaps: Vec::new(),
        }
    }

    fn doc() -> Document {
        Document::new(
            Kind::Backup,
            "0.1.0",
            UtcMs(1_709_210_096_789),
            "UTC+00:00",
            None,
            data(),
        )
    }

    #[test]
    fn plain_and_gzip_round_trip() {
        let original = doc();
        assert_eq!(Document::parse(&original.to_json()).unwrap(), original);
        assert_eq!(Document::parse(&original.to_gzip()).unwrap(), original);
    }

    #[test]
    fn the_document_has_the_published_top_level_fields() {
        let value: serde_json::Value = serde_json::from_slice(&doc().to_json()).unwrap();
        for key in [
            "format",
            "kind",
            "schema_version",
            "app_version",
            "exported_at",
            "timezone",
            "range",
            "activities",
            "rules",
            "segments",
            "goals",
            "focus_sessions",
            "ai_reviews",
        ] {
            assert!(value.get(key).is_some(), "missing `{key}`");
        }
        assert_eq!(value["exported_at"], "2024-02-29T12:34:56Z");
        assert_eq!(value["schema_version"], 1);
    }

    #[test]
    fn unknown_fields_are_ignored_and_reserved_arrays_may_be_missing() {
        let mut value: serde_json::Value = serde_json::from_slice(&doc().to_json()).unwrap();
        value["brand_new"] = serde_json::json!({"x": 1});
        value.as_object_mut().unwrap().remove("goals");
        let parsed = Document::parse(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(parsed.goals.is_empty());
        assert_eq!(parsed.data.segments.len(), 1);
    }

    #[test]
    fn future_versions_and_foreign_or_corrupt_files_are_rejected() {
        let mut future: serde_json::Value = serde_json::from_slice(&doc().to_json()).unwrap();
        future["schema_version"] = 2.into();
        assert_eq!(
            Document::parse(&serde_json::to_vec(&future).unwrap()),
            Err(DocumentError::FutureVersion(2))
        );
        assert_eq!(
            Document::parse(br#"{"format":"other","schema_version":1}"#),
            Err(DocumentError::NotATimeTrackFile)
        );
        assert!(matches!(
            Document::parse(b"not json at all"),
            Err(DocumentError::NotJson(_))
        ));
        let mut gz = doc().to_gzip();
        gz.truncate(gz.len() / 2);
        assert!(matches!(
            Document::parse(&gz),
            Err(DocumentError::NotJson(_))
        ));
    }

    #[test]
    fn dangling_references_and_open_segments_are_handled() {
        let mut broken = doc();
        broken.data.rules[0].activity_id = 99;
        assert!(matches!(
            Document::parse(&broken.to_json()),
            Err(DocumentError::Inconsistent(_))
        ));

        let mut open = doc();
        open.data.segments[0].ended_at = None;
        open.data.segments[0].end_reason = None;
        let parsed = Document::parse(&open.to_json()).unwrap();
        assert_eq!(parsed.data.segments[0].ended_at, Some(5_000));
        assert_eq!(
            parsed.data.segments[0].end_reason.as_deref(),
            Some("recovered")
        );
    }

    #[test]
    fn titles_can_be_stripped_and_the_summary_counts() {
        let mut d = data();
        d.strip_titles();
        assert!(d.segments[0].window_title.is_none());
        let s = doc().summary();
        assert_eq!((s.activities, s.rules, s.segments), (2, 1, 1));
        assert_eq!((s.first_at, s.last_at), (Some(1_000), Some(5_000)));
    }

    #[test]
    fn the_serialized_document_never_mentions_secrets() {
        let text = String::from_utf8(doc().to_json()).unwrap().to_lowercase();
        assert!(!text.contains("api_key") && !text.contains("apikey") && !text.contains("secret"));
    }

    #[test]
    fn iso_dates_handle_leap_day_and_pre_epoch() {
        assert_eq!(iso_utc(UtcMs(1_709_210_096_789)), "2024-02-29T12:34:56Z");
        assert_eq!(iso_utc(UtcMs(-1)), "1969-12-31T23:59:59Z");
    }
}
