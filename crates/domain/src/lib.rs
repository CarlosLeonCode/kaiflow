//! Pure domain model: no Tauri, no OS, no I/O (R1.7).

pub mod activity;
pub mod backup_retention;
pub mod calendar;
pub mod focus;
pub mod goals;
pub mod idle_gap;
pub mod insights;
pub mod machine;
pub mod presets;
pub mod privacy;
pub mod report;
pub mod segment;
pub mod time;

pub use activity::{
    Activity, ActivityRule, InvalidPattern, Productivity, RuleKind, UNASSIGNED, classify,
};
pub use calendar::{HourSlot, Period};
pub use focus::FocusSnapshot;
pub use goals::{
    ClosedPeriod, CurrentPeriod, EventKind as GoalEventKind, Goal, GoalError, GoalKind, GoalScope,
    GoalState, Outcome, Progress, Streak,
};
pub use idle_gap::{
    AssignedSpan, DEFAULT_IDLE_PROMPT_TIMEOUT_MS, GapError, GapId, GapStatus, IdleGap, clamp_since,
};
pub use insights::{FocusRatio, Trend, focus_ratio, trend};
pub use machine::{Effect, Event, PermissionState, TrackingMachine};
pub use presets::{AppHints, PRESETS, Preset, PresetActivity, SeenApp, Suggestion};
pub use privacy::{PrivacyPolicy, apply_privacy};
pub use report::{ClippedSpan, clip_to_range, split_at_boundaries};
pub use segment::{
    ActivityId, EndReason, IdleResolution, Segment, SegmentError, SegmentId, SegmentSource,
};
pub use time::UtcMs;
