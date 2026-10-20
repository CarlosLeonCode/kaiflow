//! Pure domain model: no Tauri, no OS, no I/O (R1.7).

pub mod category;
pub mod focus;
pub mod idle_gap;
pub mod machine;
pub mod privacy;
pub mod report;
pub mod segment;
pub mod time;

pub use category::{Category, CategoryRule, InvalidPattern, RuleKind, UNCATEGORIZED, categorize};
pub use focus::FocusSnapshot;
pub use idle_gap::{
    AssignedSpan, GapError, GapId, GapStatus, IDLE_PROMPT_TIMEOUT_MS, IdleGap, clamp_since,
};
pub use machine::{Effect, Event, PermissionState, TrackingMachine};
pub use privacy::{PrivacyPolicy, apply_privacy};
pub use report::{ClippedSpan, clip_to_range, split_at_boundaries};
pub use segment::{
    CategoryId, EndReason, IdleResolution, Segment, SegmentError, SegmentId, SegmentSource,
};
pub use time::UtcMs;
