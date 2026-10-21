//! Write use cases behind the UI (design section 8): activities, rules, privacy,
//! settings and data deletion. Destructive deletions need a `confirm_token` obtained
//! from `prepare_delete` (R10.4): single use, bound to the exact operation, short-lived.

use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use domain::{
    Activity, ActivityId, ActivityRule, InvalidPattern, PrivacyPolicy, Productivity, RuleKind,
    UNASSIGNED, UtcMs,
};

use crate::idle_policy::{DEFAULT_AUTO_DISCARD_BELOW_SECS, DEFAULT_PROMPT_TIMEOUT_SECS};
use crate::ports::{
    ActivityRepository, PortError, PrivacyMode, PrivacyRepository, RetentionRepository,
    SettingsRepository,
};
use crate::queries::Range;
use crate::settings_blobs::{KEY_UI, UiSettings, read_blob, write_blob};

/// How long a confirmation token stays valid.
pub const CONFIRM_TOKEN_TTL_MS: i64 = 60_000;
const DAY_MS: i64 = 86_400_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandError {
    /// Bad title pattern (R9.4); nothing is persisted.
    InvalidPattern(InvalidPattern),
    /// Input rejected before reaching storage.
    Invalid(String),
    NotFound,
    /// A destructive operation without a valid, matching, unexpired token.
    ConfirmationRequired,
    Storage(PortError),
}

impl fmt::Display for CommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPattern(p) => write!(f, "invalid pattern `{}`: {}", p.pattern, p.reason),
            Self::Invalid(m) => f.write_str(m),
            Self::NotFound => f.write_str("not found"),
            Self::ConfirmationRequired => f.write_str("confirmation required"),
            Self::Storage(e) => e.fmt(f),
        }
    }
}

impl std::error::Error for CommandError {}

impl From<PortError> for CommandError {
    fn from(e: PortError) -> Self {
        Self::Storage(e)
    }
}

impl From<InvalidPattern> for CommandError {
    fn from(e: InvalidPattern) -> Self {
        Self::InvalidPattern(e)
    }
}

/// Unvalidated rule coming from the UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleInput {
    /// `<= 0` creates a rule.
    pub id: i64,
    pub activity_id: ActivityId,
    pub kind: RuleSpec,
    pub priority: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuleSpec {
    App(String),
    TitlePattern {
        pattern: String,
        app_id: Option<String>,
    },
}

/// Destructive operations that need a confirmation token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeleteOp {
    Range(Range),
    OlderThanDays(u32),
    All,
}

/// Opaque single-use token returned by `prepare_delete`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfirmToken(pub String);

struct Pending {
    token: String,
    op: DeleteOp,
    issued_at: UtcMs,
}

/// What purging data older than some days would touch, shown before the user confirms.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetentionImpact {
    /// Closed segments the purge would delete.
    pub segments: usize,
    /// Days of an active goal streak the purge would cut; `None` when it cuts none.
    pub streak_days_cut: Option<u32>,
}

/// What the menu-bar / tray text next to the icon shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TrayDisplay {
    /// Icon only.
    Off,
    /// Today's tracked total, e.g. `3h 12m`.
    #[default]
    TodayTotal,
    /// The focused app and its total today, e.g. `Xcode · 40m`.
    CurrentApp,
    /// Both, e.g. `3h 12m · Xcode 40m`.
    TodayAndCurrent,
}

impl TrayDisplay {
    pub const ALL: [Self; 4] = [
        Self::Off,
        Self::TodayTotal,
        Self::CurrentApp,
        Self::TodayAndCurrent,
    ];

    /// Stable name used in the settings table and on the wire.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::TodayTotal => "today_total",
            Self::CurrentApp => "current_app",
            Self::TodayAndCurrent => "today_and_current",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|d| d.as_str() == name)
    }
}

/// All user settings with their defaults (design section 7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    pub store_titles: bool,
    pub idle_threshold_secs: u32,
    pub idle_prompt_timeout_secs: u32,
    /// Gaps shorter than this are discarded without asking (0 = always ask).
    pub idle_auto_discard_below_secs: u32,
    /// `None` keeps data indefinitely (S5).
    pub retention_days: Option<u32>,
    /// `light`, `dark` or `system`.
    pub theme: String,
    pub autostart: bool,
    pub shortcut: String,
    pub onboarding_completed: bool,
    pub tray_display: TrayDisplay,
    /// Interface state kept across restarts (`ui` blob).
    pub ui: UiSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            store_titles: true,
            idle_threshold_secs: 300,
            idle_prompt_timeout_secs: DEFAULT_PROMPT_TIMEOUT_SECS,
            idle_auto_discard_below_secs: DEFAULT_AUTO_DISCARD_BELOW_SECS,
            retention_days: None,
            theme: "system".into(),
            autostart: false,
            shortcut: "⌃⌥⌘T".into(),
            onboarding_completed: false,
            tray_display: TrayDisplay::default(),
            ui: UiSettings::default(),
        }
    }
}

/// Partial update; `None` leaves a setting untouched.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SettingsPatch {
    pub store_titles: Option<bool>,
    pub idle_threshold_secs: Option<u32>,
    pub idle_prompt_timeout_secs: Option<u32>,
    pub idle_auto_discard_below_secs: Option<u32>,
    /// `Some(None)` switches retention off.
    pub retention_days: Option<Option<u32>>,
    pub theme: Option<String>,
    pub autostart: Option<bool>,
    pub shortcut: Option<String>,
    pub onboarding_completed: Option<bool>,
    pub tray_display: Option<TrayDisplay>,
    /// Replaces the whole `ui` blob.
    pub ui: Option<UiSettings>,
}

pub struct Commands {
    activities: Arc<dyn ActivityRepository>,
    privacy: Arc<dyn PrivacyRepository>,
    settings: Arc<dyn SettingsRepository>,
    retention: Arc<dyn RetentionRepository>,
    pending: Mutex<Option<Pending>>,
    counter: AtomicU64,
}

impl Commands {
    pub fn new(
        activities: Arc<dyn ActivityRepository>,
        privacy: Arc<dyn PrivacyRepository>,
        settings: Arc<dyn SettingsRepository>,
        retention: Arc<dyn RetentionRepository>,
    ) -> Self {
        Self {
            activities,
            privacy,
            settings,
            retention,
            pending: Mutex::new(None),
            counter: AtomicU64::new(0),
        }
    }

    // ---- activities and rules (R9.1, R9.4) ----

    pub fn create_activity(
        &self,
        name: &str,
        color: &str,
        productivity: Productivity,
    ) -> Result<Activity, CommandError> {
        let (name, color) = validate_activity_fields(name, color)?;
        Ok(self.activities.create(name, color, productivity)?)
    }

    pub fn update_activity(&self, activity: &Activity) -> Result<(), CommandError> {
        let (name, color) = validate_activity_fields(&activity.name, &activity.color)?;
        if !self.activities.list()?.iter().any(|c| c.id == activity.id) {
            return Err(CommandError::NotFound);
        }
        let clean = Activity {
            name: name.to_owned(),
            color: color.to_owned(),
            ..activity.clone()
        };
        Ok(self.activities.update(&clean)?)
    }

    /// Time assigned to the activity falls back to "Unassigned" (adapter's job).
    pub fn delete_activity(&self, id: ActivityId) -> Result<(), CommandError> {
        if id == UNASSIGNED {
            return Err(CommandError::Invalid(
                "the system activity cannot be deleted".into(),
            ));
        }
        Ok(self.activities.delete(id)?)
    }

    /// Validates (regex included) before anything is persisted; returns the rule id.
    pub fn save_rule(&self, input: &RuleInput) -> Result<i64, CommandError> {
        let rule = match &input.kind {
            RuleSpec::App(bundle) => {
                if bundle.trim().is_empty() {
                    return Err(CommandError::Invalid("app id must not be empty".into()));
                }
                ActivityRule {
                    id: input.id,
                    activity_id: input.activity_id,
                    kind: RuleKind::App(bundle.trim().to_owned()),
                    priority: input.priority,
                }
            }
            RuleSpec::TitlePattern { pattern, app_id } => ActivityRule::title_pattern(
                input.id,
                input.activity_id,
                pattern,
                app_id.clone(),
                input.priority,
            )?,
        };
        Ok(self.activities.save_rule(&rule)?)
    }

    pub fn delete_rule(&self, id: i64) -> Result<(), CommandError> {
        Ok(self.activities.delete_rule(id)?)
    }

    // ---- privacy (R10.2, R10.3, R10.5) ----

    pub fn privacy_policy(&self) -> Result<PrivacyPolicy, CommandError> {
        Ok(self.privacy.load_policy()?)
    }

    /// `None` removes the rule. Applies to future snapshots only (R10.5).
    pub fn set_privacy_mode(
        &self,
        app_id: &str,
        mode: Option<PrivacyMode>,
    ) -> Result<(), CommandError> {
        if app_id.trim().is_empty() {
            return Err(CommandError::Invalid("app id must not be empty".into()));
        }
        Ok(self.privacy.set_mode(app_id.trim(), mode)?)
    }

    // ---- settings ----

    pub fn get_settings(&self) -> Result<Settings, CommandError> {
        let d = Settings::default();
        Ok(Settings {
            store_titles: self.read(KEY_STORE_TITLES, parse_bool, d.store_titles)?,
            idle_threshold_secs: self.read(KEY_IDLE_THRESHOLD, parse_u32, d.idle_threshold_secs)?,
            idle_prompt_timeout_secs: self.read(
                KEY_IDLE_TIMEOUT,
                parse_u32,
                d.idle_prompt_timeout_secs,
            )?,
            idle_auto_discard_below_secs: self.read(
                KEY_IDLE_AUTO_DISCARD,
                parse_u32,
                d.idle_auto_discard_below_secs,
            )?,
            retention_days: self.read(KEY_RETENTION, parse_opt_u32, d.retention_days)?,
            theme: self.read(KEY_THEME, parse_string, d.theme)?,
            autostart: self.read(KEY_AUTOSTART, parse_bool, d.autostart)?,
            shortcut: self.read(KEY_SHORTCUT, parse_string, d.shortcut)?,
            onboarding_completed: self.read(KEY_ONBOARDING, parse_bool, d.onboarding_completed)?,
            tray_display: self.read(KEY_TRAY_DISPLAY, parse_tray_display, d.tray_display)?,
            ui: read_blob(self.settings.as_ref(), KEY_UI)?,
        })
    }

    /// Validates the whole patch first, then persists it; returns the resulting settings.
    pub fn update_settings(&self, patch: &SettingsPatch) -> Result<Settings, CommandError> {
        validate_patch(patch)?;
        let set = |key: &str, value: String| self.settings.set(key, &value);
        if let Some(v) = patch.store_titles {
            set(KEY_STORE_TITLES, v.to_string())?;
        }
        if let Some(v) = patch.idle_threshold_secs {
            set(KEY_IDLE_THRESHOLD, v.to_string())?;
        }
        if let Some(v) = patch.idle_prompt_timeout_secs {
            set(KEY_IDLE_TIMEOUT, v.to_string())?;
        }
        if let Some(v) = patch.idle_auto_discard_below_secs {
            set(KEY_IDLE_AUTO_DISCARD, v.to_string())?;
        }
        if let Some(v) = patch.retention_days {
            set(
                KEY_RETENTION,
                v.map_or("null".to_owned(), |d| d.to_string()),
            )?;
        }
        if let Some(v) = &patch.theme {
            set(KEY_THEME, json_string(v))?;
        }
        if let Some(v) = patch.autostart {
            set(KEY_AUTOSTART, v.to_string())?;
        }
        if let Some(v) = &patch.shortcut {
            set(KEY_SHORTCUT, json_string(v))?;
        }
        if let Some(v) = patch.onboarding_completed {
            set(KEY_ONBOARDING, v.to_string())?;
        }
        if let Some(v) = patch.tray_display {
            set(KEY_TRAY_DISPLAY, json_string(v.as_str()))?;
        }
        if let Some(v) = &patch.ui {
            write_blob(self.settings.as_ref(), KEY_UI, &v.clone().normalized())?;
        }
        self.get_settings()
    }

    fn read<T>(
        &self,
        key: &str,
        parse: fn(&str) -> Option<T>,
        default: T,
    ) -> Result<T, CommandError> {
        match self.settings.get(key)? {
            None => Ok(default),
            Some(raw) => parse(&raw)
                .ok_or_else(|| PortError(format!("invalid value for setting {key}: {raw}")).into()),
        }
    }

    // ---- retention (R10.4) ----

    /// Step one of every deletion: validates it and issues the token the UI must send
    /// back after the user confirmed. A new request replaces any earlier pending one.
    pub fn prepare_delete(&self, op: DeleteOp, now: UtcMs) -> Result<ConfirmToken, CommandError> {
        match op {
            DeleteOp::Range(r) if r.from >= r.to => {
                return Err(CommandError::Invalid(
                    "range start must be before its end".into(),
                ));
            }
            DeleteOp::OlderThanDays(0) => {
                return Err(CommandError::Invalid("days must be at least 1".into()));
            }
            _ => {}
        }
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        let token = format!("{:x}-{n:x}", now.0);
        *self.lock_pending() = Some(Pending {
            token: token.clone(),
            op,
            issued_at: now,
        });
        Ok(ConfirmToken(token))
    }

    /// Dry run of `purge_older_than`: how much it would remove and whether it would cut an
    /// active streak, so the confirmation can warn first.
    pub fn retention_impact(&self, days: u32, now: UtcMs) -> Result<RetentionImpact, CommandError> {
        if days == 0 {
            return Err(CommandError::Invalid("days must be at least 1".into()));
        }
        let segments = self.retention.count_older_than(cutoff(now, days))?;
        // TODO(goals unit): streaks do not exist yet. Once `GoalService` can report the first
        // day of each active streak, fill `streak_days_cut` with
        // `domain::goals::retention_cuts_streak(cutoff, streak.start)`.
        Ok(RetentionImpact {
            segments,
            streak_days_cut: None,
        })
    }

    /// Deletes closed segments that started in the range; returns how many.
    pub fn delete_range(
        &self,
        range: Range,
        token: &ConfirmToken,
        now: UtcMs,
    ) -> Result<usize, CommandError> {
        self.confirm(DeleteOp::Range(range), token, now)?;
        Ok(self.retention.delete_range(range.from, range.to)?)
    }

    /// Deletes data that ended more than `days` days before `now`.
    pub fn purge_older_than(
        &self,
        days: u32,
        token: &ConfirmToken,
        now: UtcMs,
    ) -> Result<usize, CommandError> {
        self.confirm(DeleteOp::OlderThanDays(days), token, now)?;
        Ok(self.retention.purge_older_than(cutoff(now, days))?)
    }

    /// Deletes every segment and gap; configuration stays. Stop tracking first.
    pub fn delete_all(&self, token: &ConfirmToken, now: UtcMs) -> Result<(), CommandError> {
        self.confirm(DeleteOp::All, token, now)?;
        Ok(self.retention.delete_all()?)
    }

    /// Startup / daily purge for the user's own `retention_days` setting: the user
    /// already opted in, so no token. Returns how many segments were removed.
    pub fn run_scheduled_purge(&self, now: UtcMs) -> Result<usize, CommandError> {
        match self.get_settings()?.retention_days {
            Some(days) if days > 0 => Ok(self.retention.purge_older_than(cutoff(now, days))?),
            _ => Ok(0),
        }
    }

    /// Consumes the pending token when it matches this exact operation and is fresh.
    fn confirm(&self, op: DeleteOp, token: &ConfirmToken, now: UtcMs) -> Result<(), CommandError> {
        let mut slot = self.lock_pending();
        match slot.as_ref() {
            Some(p) if p.token == token.0 && p.op == op => {
                let fresh = (0..=CONFIRM_TOKEN_TTL_MS).contains(&now.since(p.issued_at));
                *slot = None;
                if fresh {
                    Ok(())
                } else {
                    Err(CommandError::ConfirmationRequired)
                }
            }
            _ => Err(CommandError::ConfirmationRequired),
        }
    }

    fn lock_pending(&self) -> std::sync::MutexGuard<'_, Option<Pending>> {
        self.pending.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn cutoff(now: UtcMs, days: u32) -> UtcMs {
    now.plus_ms(-(i64::from(days) * DAY_MS))
}

fn validate_activity_fields<'a>(
    name: &'a str,
    color: &'a str,
) -> Result<(&'a str, &'a str), CommandError> {
    let (name, color) = (name.trim(), color.trim());
    if name.is_empty() {
        return Err(CommandError::Invalid("name must not be empty".into()));
    }
    if color.is_empty() {
        return Err(CommandError::Invalid("color must not be empty".into()));
    }
    Ok((name, color))
}

fn validate_patch(p: &SettingsPatch) -> Result<(), CommandError> {
    let bad = |m: &str| Err(CommandError::Invalid(m.to_owned()));
    if p.idle_threshold_secs
        .is_some_and(|v| !(1..=86_400).contains(&v))
    {
        return bad("idle threshold must be between 1 and 86400 seconds");
    }
    if p.idle_prompt_timeout_secs
        .is_some_and(|v| !(1..=86_400).contains(&v))
    {
        return bad("idle prompt timeout must be between 1 and 86400 seconds");
    }
    if p.idle_auto_discard_below_secs.is_some_and(|v| v > 86_400) {
        return bad("auto-discard limit must be between 0 and 86400 seconds");
    }
    if p.retention_days == Some(Some(0)) {
        return bad("retention must be at least 1 day (or off)");
    }
    if p.theme
        .as_deref()
        .is_some_and(|t| !["light", "dark", "system"].contains(&t))
    {
        return bad("theme must be light, dark or system");
    }
    if p.shortcut.as_deref().is_some_and(|s| s.trim().is_empty()) {
        return bad("shortcut must not be empty");
    }
    if let Some(Err(message)) = p.ui.as_ref().map(UiSettings::validate) {
        return bad(&message);
    }
    Ok(())
}

// ---- settings keys and the JSON subset they use (bool, integer, null, string) ----

const KEY_STORE_TITLES: &str = "store_titles";
const KEY_IDLE_THRESHOLD: &str = "idle_threshold_secs";
const KEY_IDLE_TIMEOUT: &str = "idle_prompt_timeout_secs";
const KEY_IDLE_AUTO_DISCARD: &str = "idle_auto_discard_below_secs";
const KEY_RETENTION: &str = "retention_days";
const KEY_THEME: &str = "theme";
const KEY_AUTOSTART: &str = "autostart";
const KEY_SHORTCUT: &str = "shortcut";
const KEY_ONBOARDING: &str = "onboarding_completed";
const KEY_TRAY_DISPLAY: &str = "tray_display";

fn parse_bool(raw: &str) -> Option<bool> {
    match raw.trim() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

fn parse_u32(raw: &str) -> Option<u32> {
    raw.trim().parse().ok()
}

fn parse_opt_u32(raw: &str) -> Option<Option<u32>> {
    match raw.trim() {
        "null" => Some(None),
        other => other.parse().ok().map(Some),
    }
}

fn parse_string(raw: &str) -> Option<String> {
    let inner = raw.trim().strip_prefix('"')?.strip_suffix('"')?;
    let mut out = String::with_capacity(inner.len());
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => return None,
            '\\' => match chars.next()? {
                '"' => out.push('"'),
                '\\' => out.push('\\'),
                '/' => out.push('/'),
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                't' => out.push('\t'),
                'u' => {
                    let hex: String = chars.by_ref().take(4).collect();
                    out.push(char::from_u32(u32::from_str_radix(&hex, 16).ok()?)?);
                }
                _ => return None,
            },
            c => out.push(c),
        }
    }
    Some(out)
}

fn parse_tray_display(raw: &str) -> Option<TrayDisplay> {
    TrayDisplay::parse(&parse_string(raw)?)
}

fn json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if c.is_control() => out.push_str(&format!("\\u{:04x}", u32::from(c))),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fakes::{FakeActivities, FakePrivacy, FakeSettings, FakeStore};
    use domain::{EndReason, Segment, SegmentId, SegmentSource};

    const DAY: i64 = DAY_MS;

    struct Fixture {
        cmd: Commands,
        store: FakeStore,
        cats: FakeActivities,
        privacy: FakePrivacy,
        settings: FakeSettings,
    }

    fn fixture() -> Fixture {
        let store = FakeStore::default();
        let cats = FakeActivities::default();
        let privacy = FakePrivacy::default();
        let settings = FakeSettings::default();
        let cmd = Commands::new(
            Arc::new(cats.clone()),
            Arc::new(privacy.clone()),
            Arc::new(settings.clone()),
            Arc::new(store.clone()),
        );
        Fixture {
            cmd,
            store,
            cats,
            privacy,
            settings,
        }
    }

    fn closed(start: i64, end: i64) -> Segment {
        Segment {
            id: SegmentId(0),
            started_at: UtcMs(start),
            ended_at: Some(UtcMs(end)),
            heartbeat_at: UtcMs(end),
            app_id: Some("a".into()),
            app_name: Some("A".into()),
            window_title: None,
            end_reason: Some(EndReason::Stop),
            source: SegmentSource::Tracked,
            activity_id: None,
        }
    }

    fn range(from: i64, to: i64) -> Range {
        Range {
            from: UtcMs(from),
            to: UtcMs(to),
        }
    }

    #[test]
    fn activity_crud_validates_input_and_protects_the_system_activity() {
        let f = fixture();
        f.cmd
            .create_activity("Unassigned", "#999", Productivity::Neutral)
            .unwrap();
        let work = f
            .cmd
            .create_activity("  Work ", "#0f0", Productivity::Neutral)
            .unwrap();
        assert_eq!(work.name, "Work");
        assert!(matches!(
            f.cmd.create_activity("  ", "#0f0", Productivity::Neutral),
            Err(CommandError::Invalid(_))
        ));
        assert!(matches!(
            f.cmd.create_activity("x", "", Productivity::Neutral),
            Err(CommandError::Invalid(_))
        ));

        let renamed = Activity {
            name: "Deep work".into(),
            ..work.clone()
        };
        f.cmd.update_activity(&renamed).unwrap();
        assert_eq!(f.cats.list().unwrap()[1].name, "Deep work");
        let ghost = Activity {
            id: ActivityId(99),
            ..work.clone()
        };
        assert_eq!(f.cmd.update_activity(&ghost), Err(CommandError::NotFound));

        assert!(matches!(
            f.cmd.delete_activity(UNASSIGNED),
            Err(CommandError::Invalid(_))
        ));
        f.cmd.delete_activity(work.id).unwrap();
        assert_eq!(f.cats.list().unwrap().len(), 1);
    }

    #[test]
    fn invalid_title_pattern_is_rejected_and_not_persisted() {
        let f = fixture();
        let input = RuleInput {
            id: 0,
            activity_id: ActivityId(2),
            kind: RuleSpec::TitlePattern {
                pattern: "(unclosed".into(),
                app_id: None,
            },
            priority: 0,
        };
        assert!(matches!(
            f.cmd.save_rule(&input),
            Err(CommandError::InvalidPattern(_))
        ));
        assert!(f.cats.list_rules().unwrap().is_empty());
    }

    #[test]
    fn valid_rules_are_saved_and_deleted() {
        let f = fixture();
        let app = RuleInput {
            id: 0,
            activity_id: ActivityId(2),
            kind: RuleSpec::App(" com.slack ".into()),
            priority: 1,
        };
        f.cmd.save_rule(&app).unwrap();
        let title = RuleInput {
            id: 5,
            kind: RuleSpec::TitlePattern {
                pattern: "Figma".into(),
                app_id: Some("chrome".into()),
            },
            ..app.clone()
        };
        assert_eq!(f.cmd.save_rule(&title).unwrap(), 5);
        let rules = f.cats.list_rules().unwrap();
        assert!(matches!(&rules[0].kind, RuleKind::App(b) if b == "com.slack"));
        assert_eq!(rules.len(), 2);

        f.cmd.delete_rule(5).unwrap();
        assert_eq!(f.cats.list_rules().unwrap().len(), 1);

        let empty = RuleInput {
            kind: RuleSpec::App(" ".into()),
            ..app
        };
        assert!(matches!(
            f.cmd.save_rule(&empty),
            Err(CommandError::Invalid(_))
        ));
    }

    #[test]
    fn privacy_modes_round_trip() {
        let f = fixture();
        f.cmd
            .set_privacy_mode("bank", Some(PrivacyMode::Exclude))
            .unwrap();
        f.cmd
            .set_privacy_mode("mail", Some(PrivacyMode::RedactTitle))
            .unwrap();
        let p = f.cmd.privacy_policy().unwrap();
        assert!(p.excluded_apps.contains("bank") && p.redacted_apps.contains("mail"));
        f.cmd.set_privacy_mode("bank", None).unwrap();
        assert!(f.cmd.privacy_policy().unwrap().excluded_apps.is_empty());
        assert!(matches!(
            f.cmd.set_privacy_mode(" ", None),
            Err(CommandError::Invalid(_))
        ));
        let _ = &f.privacy;
    }

    #[test]
    fn dismissed_intros_persist_as_a_ui_blob_and_are_validated() {
        let f = fixture();
        assert!(f.cmd.get_settings().unwrap().ui.dismissed_intros.is_empty());
        let out = f
            .cmd
            .update_settings(&SettingsPatch {
                ui: Some(UiSettings {
                    dismissed_intros: vec!["today".into(), "today".into(), "activities".into()],
                }),
                ..SettingsPatch::default()
            })
            .unwrap();
        assert_eq!(out.ui.dismissed_intros, ["today", "activities"]);
        assert_eq!(
            f.settings.get("ui").unwrap().as_deref(),
            Some(r#"{"dismissed_intros":["today","activities"]}"#)
        );
        // Unrelated patches leave the blob alone.
        f.cmd
            .update_settings(&SettingsPatch {
                theme: Some("dark".into()),
                ..SettingsPatch::default()
            })
            .unwrap();
        assert_eq!(f.cmd.get_settings().unwrap().ui.dismissed_intros.len(), 2);
        assert!(matches!(
            f.cmd.update_settings(&SettingsPatch {
                ui: Some(UiSettings {
                    dismissed_intros: vec!["".into()],
                }),
                ..SettingsPatch::default()
            }),
            Err(CommandError::Invalid(_))
        ));
    }

    #[test]
    fn settings_default_then_patch_persists_as_json() {
        let f = fixture();
        assert_eq!(f.cmd.get_settings().unwrap(), Settings::default());

        let out = f
            .cmd
            .update_settings(&SettingsPatch {
                store_titles: Some(false),
                idle_threshold_secs: Some(600),
                retention_days: Some(Some(30)),
                theme: Some("dark".into()),
                shortcut: Some("⌃⌥⌘P".into()),
                onboarding_completed: Some(true),
                tray_display: Some(TrayDisplay::TodayAndCurrent),
                ..Default::default()
            })
            .unwrap();
        assert!(!out.store_titles && out.onboarding_completed);
        assert_eq!(out.tray_display, TrayDisplay::TodayAndCurrent);
        assert_eq!(
            f.settings.get("tray_display").unwrap().as_deref(),
            Some("\"today_and_current\"")
        );
        assert_eq!(
            (
                out.idle_threshold_secs,
                out.retention_days,
                out.theme.as_str()
            ),
            (600, Some(30), "dark")
        );
        assert_eq!(out.shortcut, "⌃⌥⌘P");
        // Raw encoding matches what the privacy adapter reads.
        assert_eq!(
            f.settings.get("store_titles").unwrap().as_deref(),
            Some("false")
        );
        assert_eq!(
            f.settings.get("theme").unwrap().as_deref(),
            Some("\"dark\"")
        );

        let out = f
            .cmd
            .update_settings(&SettingsPatch {
                retention_days: Some(None),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(out.retention_days, None);
        assert_eq!(out.idle_threshold_secs, 600);
    }

    #[test]
    fn idle_policy_settings_default_persist_and_validate() {
        let f = fixture();
        let d = f.cmd.get_settings().unwrap();
        assert_eq!(
            (d.idle_prompt_timeout_secs, d.idle_auto_discard_below_secs),
            (600, 120)
        );
        let out = f
            .cmd
            .update_settings(&SettingsPatch {
                idle_prompt_timeout_secs: Some(300),
                idle_auto_discard_below_secs: Some(0),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(
            (
                out.idle_prompt_timeout_secs,
                out.idle_auto_discard_below_secs
            ),
            (300, 0)
        );
        assert_eq!(
            f.settings
                .get("idle_auto_discard_below_secs")
                .unwrap()
                .as_deref(),
            Some("0")
        );
        assert!(matches!(
            f.cmd.update_settings(&SettingsPatch {
                idle_auto_discard_below_secs: Some(86_401),
                ..Default::default()
            }),
            Err(CommandError::Invalid(_))
        ));
    }

    #[test]
    fn invalid_patch_changes_nothing() {
        let f = fixture();
        let bad = SettingsPatch {
            store_titles: Some(false),
            idle_threshold_secs: Some(0),
            ..Default::default()
        };
        assert!(matches!(
            f.cmd.update_settings(&bad),
            Err(CommandError::Invalid(_))
        ));
        assert_eq!(f.settings.get("store_titles").unwrap(), None);
        for patch in [
            SettingsPatch {
                theme: Some("neon".into()),
                ..Default::default()
            },
            SettingsPatch {
                retention_days: Some(Some(0)),
                ..Default::default()
            },
            SettingsPatch {
                shortcut: Some(" ".into()),
                ..Default::default()
            },
        ] {
            assert!(matches!(
                f.cmd.update_settings(&patch),
                Err(CommandError::Invalid(_))
            ));
        }
    }

    #[test]
    fn corrupt_stored_setting_is_an_error_not_a_silent_default() {
        let f = fixture();
        f.settings.set("autostart", "maybe").unwrap();
        assert!(matches!(
            f.cmd.get_settings(),
            Err(CommandError::Storage(_))
        ));
    }

    #[test]
    fn tray_display_names_round_trip_and_unknown_values_are_rejected() {
        for display in TrayDisplay::ALL {
            assert_eq!(TrayDisplay::parse(display.as_str()), Some(display));
            assert_eq!(
                parse_tray_display(&json_string(display.as_str())),
                Some(display)
            );
        }
        assert_eq!(Settings::default().tray_display, TrayDisplay::TodayTotal);
        assert_eq!(parse_tray_display("\"neon\""), None);
        assert_eq!(parse_tray_display("today_total"), None);

        let f = fixture();
        f.settings.set("tray_display", "\"neon\"").unwrap();
        assert!(matches!(
            f.cmd.get_settings(),
            Err(CommandError::Storage(_))
        ));
    }

    #[test]
    fn json_strings_round_trip_with_escapes() {
        for s in ["plain", "a\"b\\c", "tab\there", "⌃⌥⌘T", "line\nbreak"] {
            assert_eq!(parse_string(&json_string(s)).as_deref(), Some(s));
        }
        assert_eq!(parse_string("nope"), None);
        assert_eq!(parse_string("\"bad\\q\""), None);
    }

    #[test]
    fn delete_without_or_with_wrong_token_is_refused_and_deletes_nothing() {
        let f = fixture();
        f.store.seed_segment(closed(0, 10));
        let now = UtcMs(1_000);
        let forged = ConfirmToken("nope".into());
        assert_eq!(
            f.cmd.delete_all(&forged, now),
            Err(CommandError::ConfirmationRequired)
        );

        // A token issued for one operation cannot authorize another.
        let token = f
            .cmd
            .prepare_delete(DeleteOp::OlderThanDays(30), now)
            .unwrap();
        assert_eq!(
            f.cmd.delete_all(&token, now),
            Err(CommandError::ConfirmationRequired)
        );
        assert_eq!(
            f.cmd.delete_range(range(0, 100), &token, now),
            Err(CommandError::ConfirmationRequired)
        );
        assert_eq!(f.store.segments().len(), 1);
    }

    #[test]
    fn token_is_single_use_and_expires() {
        let f = fixture();
        f.store.seed_segment(closed(0, 10));
        let t0 = UtcMs(1_000);

        let token = f.cmd.prepare_delete(DeleteOp::All, t0).unwrap();
        f.cmd.delete_all(&token, t0.plus_ms(5)).unwrap();
        assert!(f.store.segments().is_empty());
        assert_eq!(
            f.cmd.delete_all(&token, t0.plus_ms(6)),
            Err(CommandError::ConfirmationRequired)
        );

        f.store.seed_segment(closed(0, 10));
        let token = f.cmd.prepare_delete(DeleteOp::All, t0).unwrap();
        assert_eq!(
            f.cmd
                .delete_all(&token, t0.plus_ms(CONFIRM_TOKEN_TTL_MS + 1)),
            Err(CommandError::ConfirmationRequired)
        );
        assert_eq!(f.store.segments().len(), 1);
    }

    #[test]
    fn a_new_prepare_replaces_the_previous_token() {
        let f = fixture();
        let now = UtcMs(10);
        let first = f.cmd.prepare_delete(DeleteOp::All, now).unwrap();
        let second = f.cmd.prepare_delete(DeleteOp::All, now).unwrap();
        assert_ne!(first, second);
        assert_eq!(
            f.cmd.delete_all(&first, now),
            Err(CommandError::ConfirmationRequired)
        );
        f.cmd.delete_all(&second, now).unwrap();
    }

    #[test]
    fn delete_range_removes_only_that_range() {
        let f = fixture();
        f.store.seed_segment(closed(0, 10));
        f.store.seed_segment(closed(100, 110));
        let now = UtcMs(1_000);
        let r = range(0, 50);
        let token = f.cmd.prepare_delete(DeleteOp::Range(r), now).unwrap();
        assert_eq!(f.cmd.delete_range(r, &token, now).unwrap(), 1);
        assert_eq!(f.store.segments().len(), 1);
        // Same operation but a different range does not match the token.
        let token = f.cmd.prepare_delete(DeleteOp::Range(r), now).unwrap();
        assert_eq!(
            f.cmd.delete_range(range(0, 500), &token, now),
            Err(CommandError::ConfirmationRequired)
        );
    }

    #[test]
    fn purge_keeps_only_the_last_n_days() {
        let f = fixture();
        let now = UtcMs(100 * DAY);
        for age in [90, 60, 31, 10, 1] {
            f.store
                .seed_segment(closed(now.0 - age * DAY, now.0 - age * DAY + 1_000));
        }
        let token = f
            .cmd
            .prepare_delete(DeleteOp::OlderThanDays(30), now)
            .unwrap();
        assert_eq!(f.cmd.purge_older_than(30, &token, now).unwrap(), 3);
        assert_eq!(f.store.segments().len(), 2);
    }

    #[test]
    fn retention_impact_counts_what_a_purge_would_delete_without_deleting() {
        let f = fixture();
        let now = UtcMs(100 * DAY);
        for age in [90, 60, 31, 10, 1] {
            f.store
                .seed_segment(closed(now.0 - age * DAY, now.0 - age * DAY + 1_000));
        }
        let impact = f.cmd.retention_impact(30, now).unwrap();
        assert_eq!(impact.segments, 3);
        assert_eq!(impact.streak_days_cut, None, "no goals exist yet");
        assert_eq!(f.store.segments().len(), 5);
        assert!(f.cmd.retention_impact(0, now).is_err());
    }

    #[test]
    fn prepare_rejects_degenerate_operations() {
        let f = fixture();
        let now = UtcMs(0);
        assert!(matches!(
            f.cmd.prepare_delete(DeleteOp::OlderThanDays(0), now),
            Err(CommandError::Invalid(_))
        ));
        assert!(matches!(
            f.cmd.prepare_delete(DeleteOp::Range(range(5, 5)), now),
            Err(CommandError::Invalid(_))
        ));
    }

    #[test]
    fn scheduled_purge_follows_the_retention_setting_without_a_token() {
        let f = fixture();
        let now = UtcMs(100 * DAY);
        f.store
            .seed_segment(closed(now.0 - 50 * DAY, now.0 - 50 * DAY + 1));
        f.store.seed_segment(closed(now.0 - DAY, now.0 - DAY + 1));

        assert_eq!(f.cmd.run_scheduled_purge(now).unwrap(), 0);
        assert_eq!(f.store.segments().len(), 2);

        f.cmd
            .update_settings(&SettingsPatch {
                retention_days: Some(Some(30)),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(f.cmd.run_scheduled_purge(now).unwrap(), 1);
        assert_eq!(f.store.segments().len(), 1);
    }
}
