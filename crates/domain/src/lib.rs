//! Pure domain model: no Tauri, no OS, no I/O (R1.7).

pub mod activity;
pub mod focus;
pub mod idle_gap;
pub mod machine;
pub mod presets;
pub mod privacy;
pub mod report;
pub mod segment;
pub mod time;

pub use activity::{
    Activity, ActivityRule, InvalidPattern, Productivity, RuleKind, UNASSIGNED, classify,
};
pub use focus::FocusSnapshot;
pub use idle_gap::{
    AssignedSpan, DEFAULT_IDLE_PROMPT_TIMEOUT_MS, GapError, GapId, GapStatus, IdleGap, clamp_since,
};
pub use machine::{Effect, Event, PermissionState, TrackingMachine};
pub use presets::{AppHints, PRESETS, Preset, PresetActivity, SeenApp, Suggestion};
pub use privacy::{PrivacyPolicy, apply_privacy};
pub use report::{ClippedSpan, clip_to_range, split_at_boundaries};
pub use segment::{
    ActivityId, EndReason, IdleResolution, Segment, SegmentError, SegmentId, SegmentSource,
};
pub use time::UtcMs;
