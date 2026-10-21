//! Wire types of the IPC contract (design section 8). Every type derives `specta::Type`, so
//! `bindings.ts` is generated from them. Timestamps are UTC milliseconds as `i64`; they stay
//! far below 2^53, so the bindings export them as TypeScript `number`.

use application::commands::{DeleteOp, RuleInput, RuleSpec, Settings, SettingsPatch, TrayDisplay};
use application::ports::{DegradedReason, PrivacyMode, TrackingKind, TrackingStatus};
use application::queries::{ActivityTotal, AppTotal, BucketTotal, Range, Report, TimelineItem};
use application::settings_blobs::UiSettings;
use domain::{
    Activity, ActivityId, ActivityRule, EndReason, FocusSnapshot, GapId, IdleGap, IdleResolution,
    PermissionState, PrivacyPolicy, Productivity, RuleKind, SegmentSource, UtcMs,
};
use serde::{Deserialize, Serialize};
use specta::Type;

/// Half-open UTC range `[from, to)` computed by the frontend (local day bounds, DST included).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct RangeDto {
    pub from: i64,
    pub to: i64,
}

impl From<RangeDto> for Range {
    fn from(r: RangeDto) -> Self {
        Range {
            from: UtcMs(r.from),
            to: UtcMs(r.to),
        }
    }
}

impl From<Range> for RangeDto {
    fn from(r: Range) -> Self {
        Self {
            from: r.from.0,
            to: r.to.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct FocusDto {
    pub app_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
}

impl From<FocusSnapshot> for FocusDto {
    fn from(f: FocusSnapshot) -> Self {
        Self {
            app_id: f.app_id,
            app_name: f.app_name,
            window_title: f.window_title,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TrackingStateDto {
    Stopped,
    Running,
    Paused,
    Idle,
    Asleep,
}

impl From<TrackingKind> for TrackingStateDto {
    fn from(k: TrackingKind) -> Self {
        match k {
            TrackingKind::Stopped => Self::Stopped,
            TrackingKind::Running => Self::Running,
            TrackingKind::Paused => Self::Paused,
            TrackingKind::Idle => Self::Idle,
            TrackingKind::Asleep => Self::Asleep,
        }
    }
}

/// Global shortcut state (R6.3); `Unavailable` keeps tracking untouched.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ShortcutStatusDto {
    Registered { shortcut: String },
    Unavailable { shortcut: String, reason: String },
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct TrackingStatusDto {
    pub state: TrackingStateDto,
    pub current: Option<FocusDto>,
    pub since: Option<i64>,
    pub degraded: bool,
    /// Why tracking is degraded; set only while `degraded` is true.
    pub degraded_reason: Option<DegradedReasonDto>,
    pub shortcut: ShortcutStatusDto,
}

impl TrackingStatusDto {
    /// `reason` is the platform's explanation for a degraded state (fixed per process).
    pub fn new(
        status: TrackingStatus,
        shortcut: ShortcutStatusDto,
        reason: DegradedReasonDto,
    ) -> Self {
        Self {
            state: status.kind.into(),
            current: status.current.map(Into::into),
            since: status.since.map(|s| s.0),
            degraded: status.degraded,
            degraded_reason: status.degraded.then_some(reason),
            shortcut,
        }
    }
}

/// Why tracking runs degraded, so the UI can explain it (and only offer System Settings
/// where a permission can fix it).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum DegradedReasonDto {
    /// macOS Accessibility not granted: app names only.
    AccessibilityDenied,
    /// Linux Wayland session: windows cannot be observed, idle still works.
    WaylandSession,
    /// No display server reachable.
    NoDisplay,
}

impl From<DegradedReason> for DegradedReasonDto {
    fn from(reason: DegradedReason) -> Self {
        match reason {
            DegradedReason::AccessibilityDenied => Self::AccessibilityDenied,
            DegradedReason::WaylandSession => Self::WaylandSession,
            DegradedReason::NoDisplay => Self::NoDisplay,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PermissionStateDto {
    Granted,
    Denied,
}

impl From<PermissionState> for PermissionStateDto {
    fn from(p: PermissionState) -> Self {
        match p {
            PermissionState::Granted => Self::Granted,
            PermissionState::Denied => Self::Denied,
        }
    }
}

/// Same enum as the domain and the database (design section 3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IdleResolutionDto {
    Discard,
    AssignPrevious,
    AssignActivity { activity_id: i64 },
}

impl From<IdleResolutionDto> for IdleResolution {
    fn from(r: IdleResolutionDto) -> Self {
        match r {
            IdleResolutionDto::Discard => Self::Discard,
            IdleResolutionDto::AssignPrevious => Self::AssignPrevious,
            IdleResolutionDto::AssignActivity { activity_id } => {
                Self::AssignActivity(ActivityId(activity_id))
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct IdleGapDto {
    pub id: i64,
    pub started_at: i64,
    pub ended_at: i64,
    pub prev_focus: Option<FocusDto>,
    pub expires_at: i64,
}

impl IdleGapDto {
    /// Gaps without a repository id cannot be resolved, so they are not exposed.
    pub fn from_gap(gap: IdleGap) -> Option<Self> {
        let GapId(id) = gap.id?;
        Some(Self {
            id,
            started_at: gap.started_at.0,
            ended_at: gap.ended_at.0,
            prev_focus: gap.prev_focus.map(Into::into),
            expires_at: gap.expires_at.0,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppTotalDto {
    /// `None` for time assigned manually to an activity.
    pub app_id: Option<String>,
    pub app_name: String,
    pub total_ms: i64,
}

impl From<AppTotal> for AppTotalDto {
    fn from(a: AppTotal) -> Self {
        Self {
            app_id: a.app_id,
            app_name: a.app_name,
            total_ms: a.total_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ActivityTotalDto {
    pub activity_id: i64,
    pub name: String,
    pub color: String,
    pub total_ms: i64,
}

impl From<ActivityTotal> for ActivityTotalDto {
    fn from(c: ActivityTotal) -> Self {
        Self {
            activity_id: c.activity_id.0,
            name: c.name,
            color: c.color,
            total_ms: c.total_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct BucketTotalDto {
    pub range: RangeDto,
    pub total_ms: i64,
}

impl From<BucketTotal> for BucketTotalDto {
    fn from(b: BucketTotal) -> Self {
        Self {
            range: b.range.into(),
            total_ms: b.total_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ReportDto {
    pub by_app: Vec<AppTotalDto>,
    pub by_activity: Vec<ActivityTotalDto>,
    pub by_bucket: Vec<BucketTotalDto>,
    pub total_ms: i64,
    pub auto_discarded_gaps: u32,
}

impl From<Report> for ReportDto {
    fn from(r: Report) -> Self {
        Self {
            by_app: r.by_app.into_iter().map(Into::into).collect(),
            by_activity: r.by_activity.into_iter().map(Into::into).collect(),
            by_bucket: r.by_bucket.into_iter().map(Into::into).collect(),
            total_ms: r.total_ms,
            auto_discarded_gaps: r.auto_discarded_gaps,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EndReasonDto {
    FocusChange,
    Idle,
    Sleep,
    Lock,
    Pause,
    Stop,
    Shutdown,
    Recovered,
}

impl From<EndReason> for EndReasonDto {
    fn from(r: EndReason) -> Self {
        match r {
            EndReason::FocusChange => Self::FocusChange,
            EndReason::Idle => Self::Idle,
            EndReason::Sleep => Self::Sleep,
            EndReason::Lock => Self::Lock,
            EndReason::Pause => Self::Pause,
            EndReason::Stop => Self::Stop,
            EndReason::Shutdown => Self::Shutdown,
            EndReason::Recovered => Self::Recovered,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SegmentSourceDto {
    Tracked,
    IdleAssigned,
}

impl From<SegmentSource> for SegmentSourceDto {
    fn from(s: SegmentSource) -> Self {
        match s {
            SegmentSource::Tracked => Self::Tracked,
            SegmentSource::IdleAssigned => Self::IdleAssigned,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct TimelineItemDto {
    pub segment_id: i64,
    pub start: i64,
    pub end: i64,
    pub app_id: Option<String>,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub activity_id: i64,
    pub activity_name: String,
    pub activity_color: String,
    pub source: SegmentSourceDto,
    pub end_reason: Option<EndReasonDto>,
    pub open: bool,
}

impl From<TimelineItem> for TimelineItemDto {
    fn from(t: TimelineItem) -> Self {
        Self {
            segment_id: t.segment_id.0,
            start: t.start.0,
            end: t.end.0,
            app_id: t.app_id,
            app_name: t.app_name,
            window_title: t.window_title,
            activity_id: t.activity_id.0,
            activity_name: t.activity_name,
            activity_color: t.activity_color,
            source: t.source.into(),
            end_reason: t.end_reason.map(Into::into),
            open: t.open,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ActivityDto {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub sort_order: i32,
    pub productivity: ProductivityDto,
    pub preset_key: Option<String>,
}

/// How an activity counts toward the focus ratio.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ProductivityDto {
    Productive,
    Neutral,
    Distracting,
}

impl From<Productivity> for ProductivityDto {
    fn from(p: Productivity) -> Self {
        match p {
            Productivity::Productive => Self::Productive,
            Productivity::Neutral => Self::Neutral,
            Productivity::Distracting => Self::Distracting,
        }
    }
}

impl From<ProductivityDto> for Productivity {
    fn from(p: ProductivityDto) -> Self {
        match p {
            ProductivityDto::Productive => Self::Productive,
            ProductivityDto::Neutral => Self::Neutral,
            ProductivityDto::Distracting => Self::Distracting,
        }
    }
}

impl From<Activity> for ActivityDto {
    fn from(c: Activity) -> Self {
        Self {
            id: c.id.0,
            name: c.name,
            color: c.color,
            sort_order: c.sort_order,
            productivity: c.productivity.into(),
            preset_key: c.preset_key,
        }
    }
}

impl From<ActivityDto> for Activity {
    fn from(c: ActivityDto) -> Self {
        Self {
            id: ActivityId(c.id),
            name: c.name,
            color: c.color,
            sort_order: c.sort_order,
            productivity: c.productivity.into(),
            preset_key: c.preset_key,
        }
    }
}

/// What a rule matches; used both to read and to write rules.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RuleSpecDto {
    App {
        app_id: String,
    },
    TitlePattern {
        pattern: String,
        app_id: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct RuleDto {
    pub id: i64,
    pub activity_id: i64,
    pub spec: RuleSpecDto,
    pub priority: i32,
}

impl From<ActivityRule> for RuleDto {
    fn from(r: ActivityRule) -> Self {
        let spec = match r.kind {
            RuleKind::App(app_id) => RuleSpecDto::App { app_id },
            RuleKind::TitlePattern { regex, app_id } => RuleSpecDto::TitlePattern {
                pattern: regex.as_str().to_owned(),
                app_id,
            },
        };
        Self {
            id: r.id,
            activity_id: r.activity_id.0,
            spec,
            priority: r.priority,
        }
    }
}

/// Rule coming from the UI; `id <= 0` creates it. Patterns are validated in Rust (R9.4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct RuleInputDto {
    pub id: i64,
    pub activity_id: i64,
    pub spec: RuleSpecDto,
    pub priority: i32,
}

impl From<RuleInputDto> for RuleInput {
    fn from(r: RuleInputDto) -> Self {
        Self {
            id: r.id,
            activity_id: ActivityId(r.activity_id),
            kind: match r.spec {
                RuleSpecDto::App { app_id } => RuleSpec::App(app_id),
                RuleSpecDto::TitlePattern { pattern, app_id } => {
                    RuleSpec::TitlePattern { pattern, app_id }
                }
            },
            priority: r.priority,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PrivacyModeDto {
    Exclude,
    RedactTitle,
}

impl From<PrivacyModeDto> for PrivacyMode {
    fn from(m: PrivacyModeDto) -> Self {
        match m {
            PrivacyModeDto::Exclude => Self::Exclude,
            PrivacyModeDto::RedactTitle => Self::RedactTitle,
        }
    }
}

/// Per-app privacy rules plus the global title switch, apps sorted for stable output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PrivacyRulesDto {
    pub store_titles: bool,
    pub excluded_apps: Vec<String>,
    pub redacted_apps: Vec<String>,
}

impl From<PrivacyPolicy> for PrivacyRulesDto {
    fn from(p: PrivacyPolicy) -> Self {
        let sorted = |set: std::collections::HashSet<String>| {
            let mut apps: Vec<String> = set.into_iter().collect();
            apps.sort();
            apps
        };
        Self {
            store_titles: p.store_titles,
            excluded_apps: sorted(p.excluded_apps),
            redacted_apps: sorted(p.redacted_apps),
        }
    }
}

/// What the menu-bar / tray text next to the icon shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TrayDisplayDto {
    Off,
    TodayTotal,
    CurrentApp,
    TodayAndCurrent,
}

impl From<TrayDisplay> for TrayDisplayDto {
    fn from(d: TrayDisplay) -> Self {
        match d {
            TrayDisplay::Off => Self::Off,
            TrayDisplay::TodayTotal => Self::TodayTotal,
            TrayDisplay::CurrentApp => Self::CurrentApp,
            TrayDisplay::TodayAndCurrent => Self::TodayAndCurrent,
        }
    }
}

impl From<TrayDisplayDto> for TrayDisplay {
    fn from(d: TrayDisplayDto) -> Self {
        match d {
            TrayDisplayDto::Off => Self::Off,
            TrayDisplayDto::TodayTotal => Self::TodayTotal,
            TrayDisplayDto::CurrentApp => Self::CurrentApp,
            TrayDisplayDto::TodayAndCurrent => Self::TodayAndCurrent,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct SettingsDto {
    pub store_titles: bool,
    pub idle_threshold_secs: u32,
    pub idle_prompt_timeout_secs: u32,
    pub idle_auto_discard_below_secs: u32,
    /// `None` keeps data indefinitely.
    pub retention_days: Option<u32>,
    pub theme: String,
    pub autostart: bool,
    pub shortcut: String,
    pub onboarding_completed: bool,
    pub tray_display: TrayDisplayDto,
    pub ui: UiSettingsDto,
}

/// Interface state persisted across restarts; patches replace the whole blob.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct UiSettingsDto {
    /// Section intros the user dismissed.
    pub dismissed_intros: Vec<String>,
}

impl From<UiSettings> for UiSettingsDto {
    fn from(u: UiSettings) -> Self {
        Self {
            dismissed_intros: u.dismissed_intros,
        }
    }
}

impl From<UiSettingsDto> for UiSettings {
    fn from(u: UiSettingsDto) -> Self {
        Self {
            dismissed_intros: u.dismissed_intros,
        }
    }
}

impl From<Settings> for SettingsDto {
    fn from(s: Settings) -> Self {
        Self {
            store_titles: s.store_titles,
            idle_threshold_secs: s.idle_threshold_secs,
            idle_prompt_timeout_secs: s.idle_prompt_timeout_secs,
            idle_auto_discard_below_secs: s.idle_auto_discard_below_secs,
            retention_days: s.retention_days,
            theme: s.theme,
            autostart: s.autostart,
            shortcut: s.shortcut,
            onboarding_completed: s.onboarding_completed,
            tray_display: s.tray_display.into(),
            ui: s.ui.into(),
        }
    }
}

/// How a patch changes retention; a tagged enum avoids the `Option<Option<_>>` ambiguity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RetentionPatchDto {
    Forever,
    Days { days: u32 },
}

/// Partial update: absent fields stay untouched.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct SettingsPatchDto {
    pub store_titles: Option<bool>,
    pub idle_threshold_secs: Option<u32>,
    pub idle_prompt_timeout_secs: Option<u32>,
    pub idle_auto_discard_below_secs: Option<u32>,
    pub retention: Option<RetentionPatchDto>,
    pub theme: Option<String>,
    pub autostart: Option<bool>,
    pub shortcut: Option<String>,
    pub onboarding_completed: Option<bool>,
    pub tray_display: Option<TrayDisplayDto>,
    pub ui: Option<UiSettingsDto>,
}

impl From<SettingsPatchDto> for SettingsPatch {
    fn from(p: SettingsPatchDto) -> Self {
        Self {
            store_titles: p.store_titles,
            idle_threshold_secs: p.idle_threshold_secs,
            idle_prompt_timeout_secs: p.idle_prompt_timeout_secs,
            idle_auto_discard_below_secs: p.idle_auto_discard_below_secs,
            retention_days: p.retention.map(|r| match r {
                RetentionPatchDto::Forever => None,
                RetentionPatchDto::Days { days } => Some(days),
            }),
            theme: p.theme,
            autostart: p.autostart,
            shortcut: p.shortcut,
            onboarding_completed: p.onboarding_completed,
            tray_display: p.tray_display.map(Into::into),
            ui: p.ui.map(Into::into),
        }
    }
}

/// Destructive operation to confirm with `prepare_delete`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DeleteOpDto {
    Range { range: RangeDto },
    OlderThanDays { days: u32 },
    All,
}

impl From<DeleteOpDto> for DeleteOp {
    fn from(op: DeleteOpDto) -> Self {
        match op {
            DeleteOpDto::Range { range } => Self::Range(range.into()),
            DeleteOpDto::OlderThanDays { days } => Self::OlderThanDays(days),
            DeleteOpDto::All => Self::All,
        }
    }
}

/// An update the updater found (R11.4). `date` is the publish date as RFC 3339 text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct UpdateInfoDto {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use application::queries::Range as AppRange;
    use domain::{ActivityRule, SegmentId};

    use super::*;

    fn focus() -> FocusSnapshot {
        FocusSnapshot {
            app_id: "com.apple.Safari".into(),
            app_name: "Safari".into(),
            pid: 42,
            window_title: Some("Docs".into()),
        }
    }

    #[test]
    fn the_degraded_reason_is_only_sent_while_degraded() {
        let status = TrackingStatus {
            kind: TrackingKind::Running,
            current: None,
            since: None,
            degraded: false,
        };
        let dto = TrackingStatusDto::new(
            status,
            ShortcutStatusDto::Disabled,
            DegradedReasonDto::AccessibilityDenied,
        );
        assert_eq!(dto.degraded_reason, None);
    }

    #[test]
    fn degraded_reasons_map_one_to_one() {
        for (reason, dto) in [
            (
                DegradedReason::AccessibilityDenied,
                DegradedReasonDto::AccessibilityDenied,
            ),
            (
                DegradedReason::WaylandSession,
                DegradedReasonDto::WaylandSession,
            ),
            (DegradedReason::NoDisplay, DegradedReasonDto::NoDisplay),
        ] {
            assert_eq!(DegradedReasonDto::from(reason), dto);
        }
    }

    #[test]
    fn status_maps_state_focus_and_shortcut() {
        let dto = TrackingStatusDto::new(
            TrackingStatus {
                kind: TrackingKind::Running,
                current: Some(focus()),
                since: Some(UtcMs(1_000)),
                degraded: true,
            },
            ShortcutStatusDto::Disabled,
            DegradedReasonDto::WaylandSession,
        );
        assert_eq!(dto.state, TrackingStateDto::Running);
        assert_eq!(dto.since, Some(1_000));
        assert!(dto.degraded);
        assert_eq!(dto.degraded_reason, Some(DegradedReasonDto::WaylandSession));
        let current = dto.current.unwrap();
        assert_eq!(current.app_id, "com.apple.Safari");
        assert_eq!(current.window_title.as_deref(), Some("Docs"));
    }

    #[test]
    fn every_tracking_kind_has_a_state() {
        let pairs = [
            (TrackingKind::Stopped, TrackingStateDto::Stopped),
            (TrackingKind::Running, TrackingStateDto::Running),
            (TrackingKind::Paused, TrackingStateDto::Paused),
            (TrackingKind::Idle, TrackingStateDto::Idle),
            (TrackingKind::Asleep, TrackingStateDto::Asleep),
        ];
        for (kind, expected) in pairs {
            assert_eq!(TrackingStateDto::from(kind), expected);
        }
    }

    #[test]
    fn range_round_trips() {
        let dto = RangeDto { from: 10, to: 20 };
        let range: AppRange = dto.into();
        assert_eq!(range.from, UtcMs(10));
        assert_eq!(RangeDto::from(range), dto);
    }

    #[test]
    fn idle_resolution_uses_the_single_shared_enum() {
        assert_eq!(
            IdleResolution::from(IdleResolutionDto::Discard),
            IdleResolution::Discard
        );
        assert_eq!(
            IdleResolution::from(IdleResolutionDto::AssignPrevious),
            IdleResolution::AssignPrevious
        );
        assert_eq!(
            IdleResolution::from(IdleResolutionDto::AssignActivity { activity_id: 7 }),
            IdleResolution::AssignActivity(ActivityId(7))
        );
    }

    #[test]
    fn idle_resolution_wire_format_is_tagged() {
        let json =
            serde_json::to_string(&IdleResolutionDto::AssignActivity { activity_id: 3 }).unwrap();
        assert_eq!(json, r#"{"kind":"assign_activity","activity_id":3}"#);
        let parsed: IdleResolutionDto = serde_json::from_str(r#"{"kind":"discard"}"#).unwrap();
        assert_eq!(parsed, IdleResolutionDto::Discard);
    }

    #[test]
    fn gap_without_id_is_not_exposed() {
        let gap = IdleGap {
            id: None,
            started_at: UtcMs(1),
            ended_at: UtcMs(2),
            prev_focus: None,
            status: domain::GapStatus::Pending,
            expires_at: UtcMs(3),
        };
        assert!(IdleGapDto::from_gap(gap.clone()).is_none());
        let dto = IdleGapDto::from_gap(IdleGap {
            id: Some(GapId(9)),
            prev_focus: Some(focus()),
            ..gap
        })
        .unwrap();
        assert_eq!(dto.id, 9);
        assert_eq!(dto.expires_at, 3);
        assert_eq!(dto.prev_focus.unwrap().app_name, "Safari");
    }

    #[test]
    fn timeline_item_maps_enums_and_ids() {
        let dto = TimelineItemDto::from(TimelineItem {
            segment_id: SegmentId(5),
            start: UtcMs(1),
            end: UtcMs(9),
            app_id: None,
            app_name: None,
            window_title: None,
            activity_id: ActivityId(2),
            activity_name: "Work".into(),
            activity_color: "#fff".into(),
            source: SegmentSource::IdleAssigned,
            end_reason: Some(EndReason::Idle),
            open: false,
        });
        assert_eq!(dto.segment_id, 5);
        assert_eq!(dto.source, SegmentSourceDto::IdleAssigned);
        assert_eq!(dto.end_reason, Some(EndReasonDto::Idle));
    }

    #[test]
    fn settings_patch_translates_retention() {
        let forever: SettingsPatch = SettingsPatchDto {
            retention: Some(RetentionPatchDto::Forever),
            ..Default::default()
        }
        .into();
        assert_eq!(forever.retention_days, Some(None));
        let days: SettingsPatch = SettingsPatchDto {
            retention: Some(RetentionPatchDto::Days { days: 30 }),
            ..Default::default()
        }
        .into();
        assert_eq!(days.retention_days, Some(Some(30)));
        let untouched: SettingsPatch = SettingsPatchDto::default().into();
        assert_eq!(untouched.retention_days, None);
        assert_eq!(untouched.tray_display, None);
    }

    #[test]
    fn tray_display_round_trips_with_the_stored_names() {
        for display in TrayDisplay::ALL {
            let dto = TrayDisplayDto::from(display);
            assert_eq!(TrayDisplay::from(dto), display);
            // The wire name is the same one the settings table stores.
            assert_eq!(
                serde_json::to_string(&dto).unwrap(),
                format!("\"{}\"", display.as_str())
            );
        }
    }

    #[test]
    fn rule_conversions_keep_patterns_and_apps() {
        let rule = ActivityRule::title_pattern(4, ActivityId(2), "^Inbox", None, 5).unwrap();
        let dto = RuleDto::from(rule);
        assert_eq!(
            dto.spec,
            RuleSpecDto::TitlePattern {
                pattern: "^Inbox".into(),
                app_id: None
            }
        );
        let input = RuleInput::from(RuleInputDto {
            id: 0,
            activity_id: 2,
            spec: RuleSpecDto::App {
                app_id: "com.x".into(),
            },
            priority: 1,
        });
        assert_eq!(input.kind, RuleSpec::App("com.x".into()));
        assert_eq!(input.activity_id, ActivityId(2));
    }

    #[test]
    fn privacy_rules_are_sorted() {
        let policy = PrivacyPolicy {
            store_titles: false,
            excluded_apps: HashSet::from(["b".to_owned(), "a".to_owned()]),
            redacted_apps: HashSet::new(),
        };
        let dto = PrivacyRulesDto::from(policy);
        assert_eq!(dto.excluded_apps, ["a", "b"]);
        assert!(!dto.store_titles);
    }

    #[test]
    fn delete_op_maps_every_variant() {
        assert_eq!(DeleteOp::from(DeleteOpDto::All), DeleteOp::All);
        assert_eq!(
            DeleteOp::from(DeleteOpDto::OlderThanDays { days: 9 }),
            DeleteOp::OlderThanDays(9)
        );
        let range = DeleteOp::from(DeleteOpDto::Range {
            range: RangeDto { from: 1, to: 2 },
        });
        assert_eq!(
            range,
            DeleteOp::Range(AppRange {
                from: UtcMs(1),
                to: UtcMs(2)
            })
        );
    }
}
