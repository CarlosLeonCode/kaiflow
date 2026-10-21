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

use crate::ai::KEY_AI;
use crate::settings_blobs::KEY_BACKUP;

/// Value of `format` this build writes.
pub const FORMAT: &str = "kaiflow";
/// Values of `format` written before the rename to Kaiflow; still accepted on restore so
/// older backups and exports keep working.
pub const LEGACY_FORMATS: [&str; 1] = ["timetrack"];
/// Highest `schema_version` this build writes and understands.
pub const SCHEMA_VERSION: u32 = 1;
/// Largest uncompressed document accepted on restore (zip-bomb guard).
pub const MAX_DOCUMENT_BYTES: u64 = 512 * 1024 * 1024;
const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];

/// Settings that belong to this device rather than to the data: never exported with the
/// document's settings and never overwritten by a restore.
///
/// The AI settings are device bound on purpose: the opt-in to send data to a provider is a
/// decision about this computer, so a restored file can never switch it on.
pub const DEVICE_SETTINGS: [&str; 5] = [
    "autostart",
    "shortcut",
    "onboarding_completed",
    KEY_BACKUP,
    KEY_AI,
];

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoalRecord {
    pub id: i64,
    pub label: String,
    /// `activity`, `app` or `total`.
    pub scope_kind: String,
    #[serde(default)]
    pub activity_id: Option<i64>,
    #[serde(default)]
    pub app_id: Option<String>,
    /// `daily`, `weekly` or `monthly`.
    pub period: String,
    /// `minimum` or `maximum`.
    pub kind: String,
    pub target_ms: i64,
    /// Bit 0 = Monday .. bit 6 = Sunday.
    #[serde(default = "all_days")]
    pub active_days: i64,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub created_at: i64,
}

fn all_days() -> i64 {
    127
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoalEventRecord {
    pub goal_id: i64,
    /// Local day number (days since 1970-01-01) of the first day of the period.
    pub period_start: i64,
    /// `reached` or `exceeded`.
    pub kind: String,
    pub at: i64,
    #[serde(default)]
    pub notified: bool,
    #[serde(default)]
    pub seen: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FocusDistractionRecord {
    pub app_id: String,
    pub app_name: String,
    pub ms: i64,
}

/// A closed focus session with what it allowed. A session still running is never exported.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FocusSessionRecord {
    pub id: i64,
    pub intent: String,
    pub started_at: i64,
    pub planned_end: i64,
    /// Sessions without an end are dropped when a document is read.
    #[serde(default)]
    pub ended_at: Option<i64>,
    /// `completed`, `cancelled` or `recovered`.
    #[serde(default)]
    pub end_reason: Option<String>,
    #[serde(default)]
    pub drift_alerts: u32,
    #[serde(default)]
    pub inside_ms: i64,
    #[serde(default)]
    pub outside_ms: i64,
    #[serde(default)]
    pub distractions: Vec<FocusDistractionRecord>,
    #[serde(default)]
    pub seen: bool,
    #[serde(default)]
    pub allowed_apps: Vec<String>,
    #[serde(default)]
    pub allowed_activities: Vec<i64>,
    /// `focus`, `timer` or `break`; documents written before timers lack it (focus).
    #[serde(default)]
    pub kind: Option<String>,
    /// The block had no task name (`intent` holds a placeholder).
    #[serde(default)]
    pub untitled: bool,
    /// Time the block spent paused.
    #[serde(default)]
    pub paused_ms: i64,
}

/// An AI weekly review kept in the history. API keys are never part of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiReviewRecord {
    pub id: i64,
    pub period_start: i64,
    pub period_end: i64,
    pub period_label: String,
    /// `anthropic`, `gemini`, `openai` or `ollama`.
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub included_titles: bool,
    pub request_json: String,
    pub response_json: String,
    /// `ok` or `text_fallback`.
    pub status: String,
    pub created_at: i64,
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
    /// Added with goals; documents written before them simply lack the array.
    pub goals: Vec<GoalRecord>,
    pub goal_events: Vec<GoalEventRecord>,
    /// Added with focus sessions; documents written before them simply lack the array.
    pub focus_sessions: Vec<FocusSessionRecord>,
    /// Added with the AI weekly review; documents written before it simply lack the array.
    pub ai_reviews: Vec<AiReviewRecord>,
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
}

/// Why a file cannot be read as a Kaiflow document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocumentError {
    NotJson(String),
    NotAKaiflowFile,
    /// Written by a newer app version.
    FutureVersion(u32),
    TooLarge,
    Inconsistent(String),
}

impl std::fmt::Display for DocumentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotJson(e) => write!(f, "the file is not a valid backup or export: {e}"),
            Self::NotAKaiflowFile => f.write_str("the file is not a Kaiflow backup or export"),
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
        let format = value.get("format").and_then(|f| f.as_str());
        if !format.is_some_and(is_known_format) {
            return Err(DocumentError::NotAKaiflowFile);
        }
        // Checked before the full parse so a future file never fails on its new fields.
        let version = value
            .get("schema_version")
            .and_then(serde_json::Value::as_u64)
            .ok_or(DocumentError::NotAKaiflowFile)?;
        let version = u32::try_from(version).unwrap_or(u32::MAX);
        if version > SCHEMA_VERSION {
            return Err(DocumentError::FutureVersion(version));
        }
        if version == 0 {
            return Err(DocumentError::NotAKaiflowFile);
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
        if self
            .data
            .goals
            .iter()
            .any(|g| g.activity_id.is_some_and(|id| !known(id)))
        {
            return bad("a goal points to an unknown activity");
        }
        let goal_ids: std::collections::HashSet<i64> =
            self.data.goals.iter().map(|g| g.id).collect();
        if goal_ids.len() != self.data.goals.len() {
            return bad("duplicate goal ids");
        }
        if self
            .data
            .goal_events
            .iter()
            .any(|e| !goal_ids.contains(&e.goal_id))
        {
            return bad("a goal event points to an unknown goal");
        }
        // A session that never ended cannot be resumed from a file: drop it, then check the rest.
        self.data.focus_sessions.retain(|s| s.ended_at.is_some());
        let mut session_ids = std::collections::HashSet::new();
        for session in &mut self.data.focus_sessions {
            if !session_ids.insert(session.id) {
                return bad("duplicate focus session ids");
            }
            let end = session.ended_at.unwrap_or(session.started_at);
            if session.planned_end <= session.started_at || end < session.started_at {
                return bad("a focus session ends before it starts");
            }
            let known_reason = session
                .end_reason
                .as_deref()
                .and_then(domain::FocusEnd::parse);
            if known_reason.is_none() {
                session.end_reason = Some("recovered".into());
            }
            if session
                .kind
                .as_deref()
                .is_some_and(|k| domain::FocusKind::parse(k).is_none())
            {
                session.kind = None;
            }
            session.paused_ms = session.paused_ms.max(0);
            if session.intent.trim().is_empty() || session.intent.chars().count() > 80 {
                return bad("a focus session has an invalid intent");
            }
            if session.allowed_activities.iter().any(|id| !known(*id)) {
                return bad("a focus session allows an unknown activity");
            }
        }
        // Reviews with a provider or status this version does not know are dropped (a newer
        // app may have written them); the rest must be coherent.
        self.data.ai_reviews.retain(|r| {
            crate::ai::ProviderKind::parse(&r.provider).is_some()
                && crate::ports::ReviewStatus::parse(&r.status).is_some()
        });
        let mut review_ids = std::collections::HashSet::new();
        for review in &self.data.ai_reviews {
            if !review_ids.insert(review.id) {
                return bad("duplicate AI review ids");
            }
            if review.period_end <= review.period_start || review.model.trim().is_empty() {
                return bad("an AI review is incomplete");
            }
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
    pub goals: usize,
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
            goals: self.data.goals.len(),
            first_at: segments.iter().map(|s| s.started_at).min(),
            last_at: segments
                .iter()
                .map(|s| s.ended_at.unwrap_or(s.heartbeat_at))
                .max(),
        }
    }
}

/// Whether `format` names a document this app reads: the current one or a legacy one.
fn is_known_format(format: &str) -> bool {
    format == FORMAT || LEGACY_FORMATS.contains(&format)
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
            goals: vec![GoalRecord {
                id: 1,
                label: "Deep work".into(),
                scope_kind: "activity".into(),
                activity_id: Some(2),
                app_id: None,
                period: "daily".into(),
                kind: "minimum".into(),
                target_ms: 7_200_000,
                active_days: 31,
                archived: false,
                created_at: 500,
            }],
            goal_events: vec![GoalEventRecord {
                goal_id: 1,
                period_start: 19_000,
                kind: "reached".into(),
                at: 900,
                notified: true,
                seen: false,
            }],
            focus_sessions: vec![FocusSessionRecord {
                id: 3,
                intent: "Write report".into(),
                started_at: 1_000,
                planned_end: 3_001_000,
                ended_at: Some(3_001_000),
                end_reason: Some("completed".into()),
                drift_alerts: 1,
                inside_ms: 2_000_000,
                outside_ms: 1_000_000,
                distractions: vec![FocusDistractionRecord {
                    app_id: "slack".into(),
                    app_name: "Slack".into(),
                    ms: 900_000,
                }],
                seen: true,
                allowed_apps: vec!["excel".into()],
                allowed_activities: vec![2],
                kind: Some("focus".into()),
                untitled: false,
                paused_ms: 0,
            }],
            ai_reviews: vec![AiReviewRecord {
                id: 3,
                period_start: 1_000,
                period_end: 9_000,
                period_label: "2024-02-26 to 2024-03-03".into(),
                provider: "ollama".into(),
                model: "llama".into(),
                included_titles: false,
                request_json: "{\"totals\":{}}".into(),
                response_json: "{\"summary\":\"ok\"}".into(),
                status: "ok".into(),
                created_at: 8_000,
            }],
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
    fn new_documents_use_the_kaiflow_format() {
        let value: serde_json::Value = serde_json::from_slice(&doc().to_json()).unwrap();
        assert_eq!(value["format"], "kaiflow");
    }

    #[test]
    fn files_written_before_the_rename_still_parse() {
        for legacy in LEGACY_FORMATS {
            let mut value: serde_json::Value = serde_json::from_slice(&doc().to_json()).unwrap();
            value["format"] = legacy.into();
            let bytes = serde_json::to_vec(&value).unwrap();
            let parsed = Document::parse(&bytes).unwrap();
            assert_eq!(parsed.data, doc().data, "{legacy}");
        }
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
        value.as_object_mut().unwrap().remove("goal_events");
        let parsed = Document::parse(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(
            parsed.data.goals.is_empty(),
            "files from before goals still restore"
        );
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
            Err(DocumentError::NotAKaiflowFile)
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

        let mut dangling_goal = doc();
        dangling_goal.data.goals[0].activity_id = Some(99);
        assert!(matches!(
            Document::parse(&dangling_goal.to_json()),
            Err(DocumentError::Inconsistent(_))
        ));
        let mut dangling_event = doc();
        dangling_event.data.goal_events[0].goal_id = 5;
        assert!(matches!(
            Document::parse(&dangling_event.to_json()),
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
    fn focus_sessions_round_trip_and_old_files_without_them_still_restore() {
        let parsed = Document::parse(&doc().to_json()).unwrap();
        assert_eq!(parsed.data.focus_sessions, data().focus_sessions);

        let mut value: serde_json::Value = serde_json::from_slice(&doc().to_json()).unwrap();
        value.as_object_mut().unwrap().remove("focus_sessions");
        let parsed = Document::parse(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(parsed.data.focus_sessions.is_empty());
    }

    #[test]
    fn unfinished_or_inconsistent_focus_sessions_are_dropped_or_rejected() {
        let mut running = doc();
        running.data.focus_sessions[0].ended_at = None;
        running.data.focus_sessions[0].end_reason = None;
        let parsed = Document::parse(&running.to_json()).unwrap();
        assert!(
            parsed.data.focus_sessions.is_empty(),
            "nothing to resume from a file"
        );

        let mut backwards = doc();
        backwards.data.focus_sessions[0].ended_at = Some(10);
        let mut unknown = doc();
        unknown.data.focus_sessions[0].allowed_activities = vec![99];
        let mut twice = doc();
        let copy = twice.data.focus_sessions[0].clone();
        twice.data.focus_sessions.push(copy);
        for bad in [backwards, unknown, twice] {
            assert!(matches!(
                Document::parse(&bad.to_json()),
                Err(DocumentError::Inconsistent(_))
            ));
        }
    }

    #[test]
    fn ai_reviews_round_trip_old_files_restore_and_bad_ones_are_handled() {
        let parsed = Document::parse(&doc().to_json()).unwrap();
        assert_eq!(parsed.data.ai_reviews, data().ai_reviews);

        let mut value: serde_json::Value = serde_json::from_slice(&doc().to_json()).unwrap();
        value.as_object_mut().unwrap().remove("ai_reviews");
        let parsed = Document::parse(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(parsed.data.ai_reviews.is_empty());

        let mut unknown = doc();
        unknown.data.ai_reviews[0].provider = "from-the-future".into();
        let parsed = Document::parse(&unknown.to_json()).unwrap();
        assert!(
            parsed.data.ai_reviews.is_empty(),
            "unknown providers are dropped"
        );

        let mut twice = doc();
        let copy = twice.data.ai_reviews[0].clone();
        twice.data.ai_reviews.push(copy);
        let mut backwards = doc();
        backwards.data.ai_reviews[0].period_end = 5;
        for bad in [twice, backwards] {
            assert!(matches!(
                Document::parse(&bad.to_json()),
                Err(DocumentError::Inconsistent(_))
            ));
        }
    }

    #[test]
    fn the_ai_settings_are_device_bound() {
        assert!(DEVICE_SETTINGS.contains(&KEY_AI));
    }

    #[test]
    fn titles_can_be_stripped_and_the_summary_counts() {
        let mut d = data();
        d.strip_titles();
        assert!(d.segments[0].window_title.is_none());
        let s = doc().summary();
        assert_eq!((s.activities, s.rules, s.segments, s.goals), (2, 1, 1, 1));
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
