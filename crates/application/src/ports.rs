//! Ports implemented by adapters (design section 5) and the values that cross them.

use std::fmt;

use crossbeam_channel::Sender;
use domain::{
    Activity, ActivityId, ActivityRule, AssignedSpan, EndReason, FocusSnapshot, GapId, GapStatus,
    IdleGap, PermissionState, PrivacyPolicy, Productivity, SeenApp, Segment, SegmentId, UtcMs,
};

/// Failure reported by an adapter (storage, OS call...). Carries a readable message only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortError(pub String);

impl fmt::Display for PortError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for PortError {}

pub type PortResult<T> = Result<T, PortError>;

/// Everything the engine can be told by the OS side. Focus is raw (before privacy).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SystemSignal {
    Focus(Option<FocusSnapshot>),
    IdleDetected { since: UtcMs },
    ActivityResumed,
    WillSleep,
    DidWake,
    ScreenLocked,
    ScreenUnlocked,
    PowerOff,
    PermissionChanged(PermissionState),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackingKind {
    Stopped,
    Running,
    Paused,
    Idle,
    Asleep,
}

/// Snapshot of the machine for `get_status` and `tracking-status-changed`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackingStatus {
    pub kind: TrackingKind,
    pub current: Option<FocusSnapshot>,
    pub since: Option<UtcMs>,
    pub degraded: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataKind {
    Segments,
    Gaps,
}

/// Facts the UI shell turns into frontend events.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DomainEvent {
    TrackingStatusChanged(TrackingStatus),
    CurrentSegmentChanged(Option<FocusSnapshot>),
    IdleGapPending(IdleGap),
    IdleGapResolved {
        id: GapId,
        status: GapStatus,
    },
    PermissionChanged(PermissionState),
    DataChanged(DataKind),
    /// A persistence call failed; the engine keeps running.
    StorageFailed(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrivacyMode {
    Exclude,
    RedactTitle,
}

pub trait Clock: Send {
    fn now(&self) -> UtcMs;
}

pub trait ActiveWindowProvider: Send {
    fn current(&self) -> Option<FocusSnapshot>;
}

pub trait IdleProvider: Send {
    fn seconds_since_input(&self) -> f64;
}

/// Activation / sleep / wake / lock / power-off notifications.
pub trait PowerEventsProvider {
    fn subscribe(&self, tx: Sender<SystemSignal>);
}

/// Why tracking runs degraded (`PermissionState::Denied`), so the UI can explain it and offer
/// the right remedy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DegradedReason {
    /// macOS Accessibility is not granted: app names only, no window titles.
    AccessibilityDenied,
    /// Linux Wayland session without a usable X11 active window: windows cannot be observed,
    /// idle detection still works.
    WaylandSession,
    /// No display server could be reached (headless Linux session).
    NoDisplay,
}

pub trait PermissionProvider: Send + Sync {
    fn accessibility(&self) -> PermissionState;
    fn request(&self);
    fn open_settings(&self);
    /// What a `Denied` state means on this platform. Fixed for the life of the process.
    fn degraded_reason(&self) -> DegradedReason {
        DegradedReason::AccessibilityDenied
    }
}

/// Write side, owned by the engine thread. At most one segment is open at a time.
pub trait SessionRepository: Send {
    fn open_segment(&mut self, focus: &FocusSnapshot, at: UtcMs) -> PortResult<SegmentId>;
    /// Closes the open segment, if any (idempotent).
    fn close_open_segment(&mut self, at: UtcMs, reason: EndReason) -> PortResult<()>;
    /// Refreshes `heartbeat_at` of the open segment (R4.2).
    fn heartbeat(&mut self, at: UtcMs) -> PortResult<()>;
    fn insert_assigned(&mut self, span: &AssignedSpan) -> PortResult<SegmentId>;
    fn insert_gap(&mut self, gap: &IdleGap) -> PortResult<GapId>;
    fn update_gap_status(&mut self, id: GapId, status: GapStatus, at: UtcMs) -> PortResult<()>;
    fn pending_gaps(&mut self) -> PortResult<Vec<IdleGap>>;
    /// Closes open segments at their `heartbeat_at` with `Recovered` (R4.3); returns how many.
    fn recover_orphans(&mut self) -> PortResult<usize>;
}

/// Read side (pool); never blocks the engine.
pub trait ReportRepository: Send + Sync {
    /// Segments overlapping `[from, to)`, unclipped; clipping lives in the domain (R8.3).
    fn segments_in_range(&self, from: UtcMs, to: UtcMs) -> PortResult<Vec<Segment>>;
    /// Idle gaps that started in `[from, to)` and were discarded automatically (no prompt).
    fn auto_discarded_gaps(&self, _from: UtcMs, _to: UtcMs) -> PortResult<u32> {
        Ok(0)
    }
    /// Every distinct app present in the history, most used first (capped by the adapter).
    fn seen_apps(&self) -> PortResult<Vec<SeenApp>> {
        Ok(Vec::new())
    }
}

pub trait SettingsRepository: Send + Sync {
    /// Values are JSON text (design section 7).
    fn get(&self, key: &str) -> PortResult<Option<String>>;
    fn set(&self, key: &str, value: &str) -> PortResult<()>;
}

pub trait ActivityRepository: Send + Sync {
    fn list(&self) -> PortResult<Vec<Activity>>;
    fn create(&self, name: &str, color: &str, productivity: Productivity) -> PortResult<Activity>;
    /// Like `create`, for an activity that comes from a preset (`preset_key` is stored).
    fn create_with_preset(
        &self,
        name: &str,
        color: &str,
        productivity: Productivity,
        preset_key: &str,
    ) -> PortResult<Activity>;
    fn update(&self, activity: &Activity) -> PortResult<()>;
    /// Reassigns manual segments to "Unassigned" in the same transaction.
    fn delete(&self, id: ActivityId) -> PortResult<()>;
    fn list_rules(&self) -> PortResult<Vec<ActivityRule>>;
    /// Returns the persisted rule id.
    /// `rule.id <= 0` inserts a new rule; a positive id updates that rule (error if missing).
    fn save_rule(&self, rule: &ActivityRule) -> PortResult<i64>;
    fn delete_rule(&self, id: i64) -> PortResult<()>;
}

pub trait PrivacyRepository: Send + Sync {
    /// `store_titles` setting combined with the per-app rules.
    fn load_policy(&self) -> PortResult<PrivacyPolicy>;
    /// `None` removes the rule.
    fn set_mode(&self, app_id: &str, mode: Option<PrivacyMode>) -> PortResult<()>;
}

/// Data deletion (R10.4). Callers confirm with the user first and stop tracking before
/// `delete_all`; deleting only touches tracked time, never activities, rules or settings.
pub trait RetentionRepository: Send + Sync {
    /// Deletes closed segments that started in `[from, to)`; returns how many.
    fn delete_range(&self, from: UtcMs, to: UtcMs) -> PortResult<usize>;
    /// Deletes closed segments (and resolved gaps) that ended before `cutoff`.
    fn purge_older_than(&self, cutoff: UtcMs) -> PortResult<usize>;
    /// Deletes every segment and gap, then compacts the store so nothing lingers on disk.
    fn delete_all(&self) -> PortResult<()>;
}

pub trait EventSink: Send {
    fn emit(&self, event: DomainEvent);
}

/// System notifications, best effort (R5.5 as amended).
pub trait Notifier: Send {
    fn idle_return(&self, gap: &IdleGap);
    fn permission_revoked(&self);
}
