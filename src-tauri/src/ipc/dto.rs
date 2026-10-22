//! Wire types of the IPC contract (design section 8). Every type derives `specta::Type`, so
//! `bindings.ts` is generated from them. Timestamps are UTC milliseconds as `i64`; they stay
//! far below 2^53, so the bindings export them as TypeScript `number`.

use application::backup::Kind;
use application::commands::{
    DeleteOp, RetentionImpact, RuleInput, RuleSpec, Settings, SettingsPatch, TrayDisplay,
};
use application::dashboard::{Dashboard, DashboardActivity, ProductivityTotals, StackedBucket};
use application::export::{BackupReport, BackupStatus, RestorePreview, RestoreReport};
use application::focus::{ActiveSession, CycleView, FocusState};
use application::goals::GoalStatus;
use application::ports::{DegradedReason, PrivacyMode, StoredFocus, TrackingKind, TrackingStatus};
use application::presets::{ApplyOutcome, SuggestionView};
use application::queries::{
    ActivityTotal, AppTotal, BucketTotal, Range, Report, RulePreview, TimelineItem, TitleTotal,
};
use application::settings_blobs::{FocusTimerSettings, UiSettings};
use domain::focus_cycle::{CardAction, EndCard, Step};
use domain::{
    Activity, ActivityId, ActivityRule, EndReason, FocusAllowed, FocusApp, FocusEnd, FocusKind,
    FocusRatio, FocusSnapshot, GapId, Goal, GoalEventKind, GoalKind, GoalScope, GoalState, IdleGap,
    IdleResolution, Period, PermissionState, Preset, PrivacyPolicy, Productivity, RuleKind,
    SegmentSource, Streak, Trend, UtcMs,
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

/// Desktop OS the app was built for; the UI words its permission and privacy copy by it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum OsDto {
    Macos,
    Windows,
    Linux,
}

/// Linux display server the tracker observes through; `None` elsewhere and without a display.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum DisplaySessionDto {
    X11,
    Wayland,
}

/// What the UI needs to know about the platform (`platform_info`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PlatformInfoDto {
    pub os: OsDto,
    pub session: Option<DisplaySessionDto>,
    /// Window titles need an OS permission (Accessibility on macOS).
    pub needs_accessibility_permission: bool,
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

/// Change against the previous period; `no_comparison` when that period has no time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TrendDto {
    NoComparison,
    Change { delta_ms: i64, pct: i32 },
}

impl From<Trend> for TrendDto {
    fn from(t: Trend) -> Self {
        match t {
            Trend::NoComparison => Self::NoComparison,
            Trend::Change { delta_ms, pct } => Self::Change { delta_ms, pct },
        }
    }
}

/// Productive share of productive plus distracting time; `no_signal` when both are zero.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FocusRatioDto {
    NoSignal,
    Ratio { ratio: f64 },
}

impl From<FocusRatio> for FocusRatioDto {
    fn from(r: FocusRatio) -> Self {
        match r {
            FocusRatio::NoSignal => Self::NoSignal,
            FocusRatio::Ratio(ratio) => Self::Ratio { ratio },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct DashboardActivityDto {
    pub activity_id: i64,
    pub name: String,
    pub color: String,
    pub productivity: ProductivityDto,
    pub total_ms: i64,
}

impl From<DashboardActivity> for DashboardActivityDto {
    fn from(a: DashboardActivity) -> Self {
        Self {
            activity_id: a.total.activity_id.0,
            name: a.total.name,
            color: a.total.color,
            productivity: a.productivity.into(),
            total_ms: a.total.total_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct TitleTotalDto {
    pub app_id: Option<String>,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub total_ms: i64,
}

impl From<TitleTotal> for TitleTotalDto {
    fn from(t: TitleTotal) -> Self {
        Self {
            app_id: t.app_id,
            app_name: t.app_name,
            window_title: t.window_title,
            total_ms: t.total_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct BucketActivityDto {
    pub activity_id: i64,
    pub total_ms: i64,
}

/// One bucket of the stacked chart with its time split by activity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct StackedBucketDto {
    pub range: RangeDto,
    pub total_ms: i64,
    pub by_activity: Vec<BucketActivityDto>,
}

impl From<StackedBucket> for StackedBucketDto {
    fn from(b: StackedBucket) -> Self {
        Self {
            range: b.range.into(),
            total_ms: b.total_ms,
            by_activity: b
                .by_activity
                .into_iter()
                .map(|(id, total_ms)| BucketActivityDto {
                    activity_id: id.0,
                    total_ms,
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ProductivityTotalsDto {
    pub productive_ms: i64,
    pub neutral_ms: i64,
    pub distracting_ms: i64,
}

impl From<ProductivityTotals> for ProductivityTotalsDto {
    fn from(p: ProductivityTotals) -> Self {
        Self {
            productive_ms: p.productive_ms,
            neutral_ms: p.neutral_ms,
            distracting_ms: p.distracting_ms,
        }
    }
}

/// Everything the Overview shows for one range, from a single call.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct DashboardDto {
    pub range: RangeDto,
    pub total_ms: i64,
    pub previous_total_ms: i64,
    pub trend: TrendDto,
    pub by_activity: Vec<DashboardActivityDto>,
    pub by_app: Vec<AppTotalDto>,
    pub top_titles: Vec<TitleTotalDto>,
    pub buckets: Vec<StackedBucketDto>,
    /// Local time by weekday and hour: index `weekday * 24 + hour`, weekday 0 = Monday.
    pub heatmap: Vec<i64>,
    pub productivity: ProductivityTotalsDto,
    pub focus_ratio: FocusRatioDto,
    pub auto_discarded_gaps: u32,
    /// Progress and streak of every active goal (the same figures as `goals_status`).
    pub goals: Vec<GoalStatusDto>,
}

impl DashboardDto {
    pub fn new(d: Dashboard, goals: Vec<GoalStatus>) -> Self {
        Self {
            goals: goals.into_iter().map(Into::into).collect(),
            ..Self::from(d)
        }
    }
}

impl From<Dashboard> for DashboardDto {
    fn from(d: Dashboard) -> Self {
        Self {
            range: d.range.into(),
            total_ms: d.total_ms,
            previous_total_ms: d.previous_total_ms,
            trend: d.trend.into(),
            by_activity: d.by_activity.into_iter().map(Into::into).collect(),
            by_app: d.by_app.into_iter().map(Into::into).collect(),
            top_titles: d.top_titles.into_iter().map(Into::into).collect(),
            buckets: d.buckets.into_iter().map(Into::into).collect(),
            heatmap: d.heatmap,
            productivity: d.productivity.into(),
            focus_ratio: d.focus_ratio.into(),
            auto_discarded_gaps: d.auto_discarded_gaps,
            goals: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PeriodDto {
    Daily,
    Weekly,
    Monthly,
}

impl From<Period> for PeriodDto {
    fn from(p: Period) -> Self {
        match p {
            Period::Daily => Self::Daily,
            Period::Weekly => Self::Weekly,
            Period::Monthly => Self::Monthly,
        }
    }
}

impl From<PeriodDto> for Period {
    fn from(p: PeriodDto) -> Self {
        match p {
            PeriodDto::Daily => Self::Daily,
            PeriodDto::Weekly => Self::Weekly,
            PeriodDto::Monthly => Self::Monthly,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum GoalKindDto {
    Minimum,
    Maximum,
}

impl From<GoalKind> for GoalKindDto {
    fn from(k: GoalKind) -> Self {
        match k {
            GoalKind::Minimum => Self::Minimum,
            GoalKind::Maximum => Self::Maximum,
        }
    }
}

impl From<GoalKindDto> for GoalKind {
    fn from(k: GoalKindDto) -> Self {
        match k {
            GoalKindDto::Minimum => Self::Minimum,
            GoalKindDto::Maximum => Self::Maximum,
        }
    }
}

/// What a goal measures: one activity, one app or all tracked time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GoalScopeDto {
    Activity { activity_id: i64 },
    App { app_id: String },
    Total,
}

impl From<GoalScope> for GoalScopeDto {
    fn from(s: GoalScope) -> Self {
        match s {
            GoalScope::Activity(id) => Self::Activity { activity_id: id.0 },
            GoalScope::App(app_id) => Self::App { app_id },
            GoalScope::Total => Self::Total,
        }
    }
}

impl From<GoalScopeDto> for GoalScope {
    fn from(s: GoalScopeDto) -> Self {
        match s {
            GoalScopeDto::Activity { activity_id } => Self::Activity(ActivityId(activity_id)),
            GoalScopeDto::App { app_id } => Self::App(app_id),
            GoalScopeDto::Total => Self::Total,
        }
    }
}

/// A goal as the UI edits it. `id <= 0` creates one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct GoalDto {
    pub id: i64,
    pub label: String,
    pub scope: GoalScopeDto,
    pub period: PeriodDto,
    pub kind: GoalKindDto,
    pub target_ms: i64,
    /// Bit 0 = Monday .. bit 6 = Sunday; only daily goals use it.
    pub active_days: u8,
    pub archived: bool,
}

impl From<Goal> for GoalDto {
    fn from(g: Goal) -> Self {
        Self {
            id: g.id,
            label: g.label,
            scope: g.scope.into(),
            period: g.period.into(),
            kind: g.kind.into(),
            target_ms: g.target_ms,
            active_days: g.active_days,
            archived: g.archived,
        }
    }
}

impl From<GoalDto> for Goal {
    fn from(g: GoalDto) -> Self {
        Self {
            id: g.id,
            label: g.label,
            scope: g.scope.into(),
            period: g.period.into(),
            kind: g.kind.into(),
            target_ms: g.target_ms,
            active_days: g.active_days,
            archived: g.archived,
            // The service stamps new goals and the store keeps the original on updates.
            created_at: UtcMs(0),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum GoalStateDto {
    Pending,
    Reached,
    Exceeded,
}

impl From<GoalState> for GoalStateDto {
    fn from(s: GoalState) -> Self {
        match s {
            GoalState::Pending => Self::Pending,
            GoalState::Reached => Self::Reached,
            GoalState::Exceeded => Self::Exceeded,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum GoalEventKindDto {
    Reached,
    Exceeded,
}

impl From<GoalEventKind> for GoalEventKindDto {
    fn from(k: GoalEventKind) -> Self {
        match k {
            GoalEventKind::Reached => Self::Reached,
            GoalEventKind::Exceeded => Self::Exceeded,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct StreakDto {
    pub current: u32,
    pub best: u32,
    /// The open period is not met (yet) and would end the streak if it closed as it is.
    pub at_risk: bool,
}

impl From<Streak> for StreakDto {
    fn from(s: Streak) -> Self {
        Self {
            current: s.current,
            best: s.best,
            at_risk: s.at_risk,
        }
    }
}

/// Progress of one goal in its current period.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct GoalStatusDto {
    pub goal: GoalDto,
    /// The current period as a UTC range `[from, to)`.
    pub period: RangeDto,
    pub actual_ms: i64,
    pub target_ms: i64,
    /// `actual / target` in whole percent; may pass 100.
    pub percent: u32,
    pub state: GoalStateDto,
    /// `false` on a rest day of a daily goal.
    pub active: bool,
    pub streak: StreakDto,
    /// A threshold crossed in this period that the user has not acknowledged yet.
    pub unseen: Option<GoalEventKindDto>,
}

impl From<GoalStatus> for GoalStatusDto {
    fn from(s: GoalStatus) -> Self {
        Self {
            goal: s.goal.into(),
            period: RangeDto {
                from: s.from.0,
                to: s.to.0,
            },
            actual_ms: s.actual_ms,
            target_ms: s.target_ms,
            percent: s.percent,
            state: s.state.into(),
            active: s.active,
            streak: s.streak.into(),
            unseen: s.unseen.map(Into::into),
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

/// One activity a preset pack would create.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PresetActivityDto {
    pub key: String,
    pub name: String,
    pub color: String,
    pub productivity: ProductivityDto,
    /// A few recognisable app names this activity covers, for the preview.
    pub example_apps: Vec<String>,
}

/// A pack of preset activities (opt-in; nothing is created until it is applied).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PresetDto {
    pub key: String,
    pub name: String,
    pub description: String,
    pub activities: Vec<PresetActivityDto>,
}

/// How many example apps a preset activity shows.
const EXAMPLE_APPS: usize = 4;

impl From<&Preset> for PresetDto {
    fn from(p: &Preset) -> Self {
        Self {
            key: p.key.into(),
            name: p.name.into(),
            description: p.description.into(),
            activities: p
                .activities
                .iter()
                .map(|a| PresetActivityDto {
                    key: a.key.into(),
                    name: a.name.into(),
                    color: a.color.into(),
                    productivity: a.productivity.into(),
                    example_apps: a
                        .hints
                        .name_tokens
                        .iter()
                        .take(EXAMPLE_APPS)
                        .map(|t| (*t).into())
                        .collect(),
                })
                .collect(),
        }
    }
}

/// What applying a pack changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ApplyPresetResultDto {
    pub activities_created: u32,
    pub rules_created: u32,
}

impl From<ApplyOutcome> for ApplyPresetResultDto {
    fn from(o: ApplyOutcome) -> Self {
        Self {
            activities_created: o.activities_created,
            rules_created: o.rules_created,
        }
    }
}

/// An app that could be filed under a preset activity. Never applied automatically.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct SuggestionDto {
    pub app_id: String,
    pub app_name: String,
    pub pack_key: String,
    pub activity_key: String,
    pub activity_name: String,
    /// The existing activity it would use; `null` when accepting creates it.
    pub activity_id: Option<i64>,
}

impl From<SuggestionView> for SuggestionDto {
    fn from(s: SuggestionView) -> Self {
        Self {
            app_id: s.app_id,
            app_name: s.app_name,
            pack_key: s.pack_key.into(),
            activity_key: s.activity_key.into(),
            activity_name: s.activity_name.into(),
            activity_id: s.activity_id.map(|id| id.0),
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

/// What a rule being written would match, so the form can say how much time it covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct RulePreviewDto {
    pub total_ms: i64,
    /// Distinct app + window title pairs among the matched time.
    pub windows: u32,
    /// Part of `total_ms` that has no activity yet (Unassigned).
    pub unassigned_ms: i64,
}

impl From<RulePreview> for RulePreviewDto {
    fn from(p: RulePreview) -> Self {
        Self {
            total_ms: p.total_ms,
            windows: p.windows,
            unassigned_ms: p.unassigned_ms,
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
    GoalProgress,
}

impl From<TrayDisplay> for TrayDisplayDto {
    fn from(d: TrayDisplay) -> Self {
        match d {
            TrayDisplay::Off => Self::Off,
            TrayDisplay::TodayTotal => Self::TodayTotal,
            TrayDisplay::CurrentApp => Self::CurrentApp,
            TrayDisplay::TodayAndCurrent => Self::TodayAndCurrent,
            TrayDisplay::GoalProgress => Self::GoalProgress,
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
            TrayDisplayDto::GoalProgress => Self::GoalProgress,
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
    /// First day of the week: 0 = Monday .. 6 = Sunday.
    pub week_start: u8,
    /// Seconds outside a focus session's allowed set before a drift alert.
    pub focus_drift_after_secs: u32,
    pub focus_timer: FocusTimerSettingsDto,
    pub ui: UiSettingsDto,
}

/// Pomodoro cycle, sound and heads-up of focus blocks; patches replace the whole blob.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct FocusTimerSettingsDto {
    /// Offer a break after each work block, and a long one every few.
    pub cycle_enabled: bool,
    pub short_break_minutes: u32,
    pub long_break_minutes: u32,
    /// Work blocks before a long break.
    pub long_break_every: u32,
    /// Start what comes next without asking.
    pub auto_start_next: bool,
    /// Sound with the end-of-block alert.
    pub sound: bool,
    /// A notification one minute before a block ends.
    pub heads_up: bool,
}

impl From<FocusTimerSettings> for FocusTimerSettingsDto {
    fn from(t: FocusTimerSettings) -> Self {
        Self {
            cycle_enabled: t.cycle_enabled,
            short_break_minutes: t.short_break_minutes,
            long_break_minutes: t.long_break_minutes,
            long_break_every: t.long_break_every,
            auto_start_next: t.auto_start_next,
            sound: t.sound,
            heads_up: t.heads_up,
        }
    }
}

impl From<FocusTimerSettingsDto> for FocusTimerSettings {
    fn from(t: FocusTimerSettingsDto) -> Self {
        Self {
            cycle_enabled: t.cycle_enabled,
            short_break_minutes: t.short_break_minutes,
            long_break_minutes: t.long_break_minutes,
            long_break_every: t.long_break_every,
            auto_start_next: t.auto_start_next,
            sound: t.sound,
            heads_up: t.heads_up,
        }
    }
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
            week_start: s.week_start,
            focus_drift_after_secs: s.focus_drift_after_secs,
            focus_timer: s.focus_timer.into(),
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
    pub week_start: Option<u8>,
    pub focus_drift_after_secs: Option<u32>,
    pub focus_timer: Option<FocusTimerSettingsDto>,
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
            week_start: p.week_start,
            focus_drift_after_secs: p.focus_drift_after_secs,
            focus_timer: p.focus_timer.map(Into::into),
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

/// Daily backup configuration and the outcome of the last run (Settings > Data).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct BackupStatusDto {
    pub enabled: bool,
    /// The folder the user picked; `null` while the default folder is used.
    pub custom_dir: Option<String>,
    /// The folder backups go to right now.
    pub dir: String,
    pub last_backup_at: Option<i64>,
    /// Message of the last failed run; cleared by the next success.
    pub last_error: Option<String>,
    /// Backups currently stored in `dir`.
    pub stored: u32,
}

impl From<BackupStatus> for BackupStatusDto {
    fn from(s: BackupStatus) -> Self {
        Self {
            enabled: s.enabled,
            custom_dir: s.custom_dir,
            dir: s.dir,
            last_backup_at: s.last_backup_at.map(|t| t.0),
            last_error: s.last_error,
            stored: u32::try_from(s.stored).unwrap_or(u32::MAX),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct BackupReportDto {
    pub path: String,
    /// Older backups the retention policy removed.
    pub removed: u32,
}

impl From<BackupReport> for BackupReportDto {
    fn from(r: BackupReport) -> Self {
        Self {
            path: r.path.display().to_string(),
            removed: u32::try_from(r.removed).unwrap_or(u32::MAX),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum DocumentKindDto {
    Backup,
    Export,
}

/// What a backup or export file contains, shown before the user confirms a restore.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct RestorePreviewDto {
    /// Single-use token `restore_apply` must send back within a minute.
    pub token: String,
    pub file_name: String,
    pub kind: DocumentKindDto,
    pub app_version: String,
    pub exported_at: String,
    pub activities: u32,
    pub rules: u32,
    pub segments: u32,
    pub idle_gaps: u32,
    /// First start and last end of the tracked time in the file (UTC ms).
    pub first_at: Option<i64>,
    pub last_at: Option<i64>,
}

impl RestorePreviewDto {
    pub fn new(preview: RestorePreview, file_name: String) -> Self {
        let n = |v: usize| u32::try_from(v).unwrap_or(u32::MAX);
        let s = preview.summary;
        Self {
            token: preview.token,
            file_name,
            kind: match s.kind {
                Kind::Backup => DocumentKindDto::Backup,
                Kind::Export => DocumentKindDto::Export,
            },
            app_version: s.app_version,
            exported_at: s.exported_at,
            activities: n(s.activities),
            rules: n(s.rules),
            segments: n(s.segments),
            idle_gaps: n(s.idle_gaps),
            first_at: s.first_at,
            last_at: s.last_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct RestoreResultDto {
    /// Complete copy of the data as it was before the restore.
    pub safety_copy: String,
}

impl From<RestoreReport> for RestoreResultDto {
    fn from(r: RestoreReport) -> Self {
        Self {
            safety_copy: r.safety_copy.display().to_string(),
        }
    }
}

/// What a retention purge would delete, so the confirmation can say so first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct RetentionImpactDto {
    pub segments: u32,
    /// Days of an active goal streak the purge would cut; `null` when it cuts none.
    pub streak_days_cut: Option<u32>,
}

impl From<RetentionImpact> for RetentionImpactDto {
    fn from(i: RetentionImpact) -> Self {
        Self {
            segments: u32::try_from(i.segments).unwrap_or(u32::MAX),
            streak_days_cut: i.streak_days_cut,
        }
    }
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

// ---- focus sessions ----

/// What a focus session allows: whole activities and individual apps.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct FocusAllowedDto {
    pub activity_ids: Vec<i64>,
    pub app_ids: Vec<String>,
}

impl From<FocusAllowed> for FocusAllowedDto {
    fn from(a: FocusAllowed) -> Self {
        Self {
            activity_ids: a.activities.into_iter().map(|id| id.0).collect(),
            app_ids: a.apps,
        }
    }
}

impl From<FocusAllowedDto> for FocusAllowed {
    fn from(a: FocusAllowedDto) -> Self {
        Self {
            activities: a.activity_ids.into_iter().map(ActivityId).collect(),
            apps: a.app_ids,
        }
    }
}

/// What a block is for: a focus block watches for drift, a timer only counts down.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum FocusKindDto {
    Focus,
    Timer,
    Break,
}

impl From<FocusKind> for FocusKindDto {
    fn from(k: FocusKind) -> Self {
        match k {
            FocusKind::Focus => Self::Focus,
            FocusKind::Timer => Self::Timer,
            FocusKind::Break => Self::Break,
        }
    }
}

impl From<FocusKindDto> for FocusKind {
    fn from(k: FocusKindDto) -> Self {
        match k {
            FocusKindDto::Focus => Self::Focus,
            FocusKindDto::Timer => Self::Timer,
            FocusKindDto::Break => Self::Break,
        }
    }
}

/// What the user starts a block with. The task name (`intent`) may be empty; only a focus
/// block needs something allowed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct FocusStartDto {
    pub kind: FocusKindDto,
    pub intent: String,
    pub planned_minutes: u32,
    pub allowed: FocusAllowedDto,
}

/// The app in front during a session and the activity it is filed under.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct FocusAppDto {
    pub app_id: String,
    pub app_name: String,
    pub activity_id: i64,
}

impl From<FocusApp> for FocusAppDto {
    fn from(a: FocusApp) -> Self {
        Self {
            app_id: a.app_id,
            app_name: a.app_name,
            activity_id: a.activity.0,
        }
    }
}

/// The running block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct FocusActiveDto {
    pub id: i64,
    pub kind: FocusKindDto,
    pub intent: String,
    pub started_at: i64,
    /// Moves on resume by the paused time.
    pub planned_end: i64,
    /// Set while paused: the time left is `planned_end - paused_at`.
    pub paused_at: Option<i64>,
    /// Planned length without the pauses, for the progress ring.
    pub planned_ms: i64,
    pub drift_alerts: u32,
    pub allowed: FocusAllowedDto,
    /// The app in front; `null` while nothing is observed (tracking paused, idle...).
    pub current: Option<FocusAppDto>,
    /// The app an unacknowledged drift alert is about.
    pub alerting: Option<FocusAppDto>,
}

impl From<ActiveSession> for FocusActiveDto {
    fn from(a: ActiveSession) -> Self {
        Self {
            id: a.id,
            kind: a.kind.into(),
            intent: a.intent,
            started_at: a.started_at.0,
            planned_end: a.planned_end.0,
            paused_at: a.paused_at.map(|t| t.0),
            planned_ms: a.planned_ms,
            drift_alerts: a.drift_alerts,
            allowed: a.allowed.into(),
            current: a.current.map(Into::into),
            alerting: a.alerting.map(Into::into),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum FocusEndDto {
    Completed,
    Cancelled,
    Recovered,
}

impl From<FocusEnd> for FocusEndDto {
    fn from(e: FocusEnd) -> Self {
        match e {
            FocusEnd::Completed => Self::Completed,
            FocusEnd::Cancelled => Self::Cancelled,
            FocusEnd::Recovered => Self::Recovered,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct FocusDistractionDto {
    pub app_id: String,
    pub app_name: String,
    pub ms: i64,
}

/// A finished session with its summary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct FocusSessionDto {
    pub id: i64,
    pub kind: FocusKindDto,
    pub intent: String,
    pub started_at: i64,
    pub planned_end: i64,
    pub ended_at: i64,
    pub end_reason: FocusEndDto,
    pub drift_alerts: u32,
    pub allowed: FocusAllowedDto,
    pub inside_ms: i64,
    pub outside_ms: i64,
    /// Share of the tracked time spent inside; `null` when nothing was tracked.
    pub percent_inside: Option<u32>,
    pub top_distractions: Vec<FocusDistractionDto>,
    /// The user acknowledged the end summary.
    pub seen: bool,
    /// Time actually spent in the block (its length without the pauses).
    pub worked_ms: i64,
}

impl From<StoredFocus> for FocusSessionDto {
    fn from(s: StoredFocus) -> Self {
        let percent_inside = s.summary.percent_inside();
        let worked_ms = s.worked_ms();
        Self {
            id: s.id,
            kind: s.kind.into(),
            intent: s.intent,
            started_at: s.started_at.0,
            planned_end: s.planned_end.0,
            ended_at: s.ended_at.unwrap_or(s.planned_end).0,
            end_reason: s.end_reason.unwrap_or(FocusEnd::Completed).into(),
            drift_alerts: s.drift_alerts,
            allowed: s.allowed.into(),
            inside_ms: s.summary.inside_ms,
            outside_ms: s.summary.outside_ms,
            percent_inside,
            top_distractions: s
                .summary
                .top_distractions
                .into_iter()
                .map(|d| FocusDistractionDto {
                    app_id: d.app_id,
                    app_name: d.app_name,
                    ms: d.ms,
                })
                .collect(),
            seen: s.seen,
            worked_ms,
        }
    }
}

/// A block the end card offers or reports.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct FocusStepDto {
    pub kind: FocusKindDto,
    pub intent: String,
    pub planned_ms: i64,
    pub long_break: bool,
}

impl From<Step> for FocusStepDto {
    fn from(s: Step) -> Self {
        Self {
            kind: s.kind.into(),
            intent: s.intent,
            planned_ms: s.planned_ms,
            long_break: s.long_break,
        }
    }
}

/// Shown when a block ran its course, until the user answers it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct FocusCardDto {
    /// The block that ended.
    pub finished: FocusStepDto,
    pub ended_at: i64,
    /// What comes next; `null` when the pomodoro cycle is off.
    pub next: Option<FocusStepDto>,
}

impl From<EndCard> for FocusCardDto {
    fn from(c: EndCard) -> Self {
        Self {
            finished: c.finished.into(),
            ended_at: c.at.0,
            next: c.next.map(Into::into),
        }
    }
}

/// The user's answer to the end card.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FocusCardActionDto {
    /// Start what the card offers.
    StartNext,
    Skip,
    /// A few more minutes of the block that ended.
    MoreTime {
        minutes: u32,
    },
}

impl From<FocusCardActionDto> for CardAction {
    fn from(a: FocusCardActionDto) -> Self {
        match a {
            FocusCardActionDto::StartNext => Self::StartNext,
            FocusCardActionDto::Skip => Self::Skip,
            FocusCardActionDto::MoreTime { minutes } => Self::MoreTime {
                ms: i64::from(minutes) * 60_000,
            },
        }
    }
}

/// Where the pomodoro cycle stands (round dots).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct FocusCycleDto {
    pub enabled: bool,
    /// Work blocks completed in this cycle.
    pub round: u32,
    /// Work blocks before the long break.
    pub every: u32,
}

impl From<CycleView> for FocusCycleDto {
    fn from(c: CycleView) -> Self {
        Self {
            enabled: c.enabled,
            round: c.round,
            every: c.every,
        }
    }
}

/// Everything the Focus views need in one call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct FocusStatusDto {
    pub active: Option<FocusActiveDto>,
    /// The latest finished session whose summary the user has not dismissed yet.
    pub unseen: Option<FocusSessionDto>,
    /// The end card of the block that just ran its course, until answered.
    pub card: Option<FocusCardDto>,
    pub cycle: FocusCycleDto,
    /// Why a focus block cannot start right now (tracking is degraded); `null` when it can.
    /// Timers and breaks can always start.
    pub unavailable: Option<DegradedReasonDto>,
}

impl FocusStatusDto {
    pub fn new(state: FocusState, unavailable: Option<DegradedReasonDto>) -> Self {
        Self {
            active: state.active.map(Into::into),
            unseen: state.unseen.map(Into::into),
            card: state.card.map(Into::into),
            cycle: state.cycle.into(),
            unavailable,
        }
    }
}
