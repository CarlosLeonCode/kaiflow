//! Typed events pushed to the frontend (design section 8) and the translation from the
//! engine's `DomainEvent`s. `translate` is pure so it is unit tested without a webview.

use std::sync::{Arc, Mutex, PoisonError};

use application::ports::{DataKind, DomainEvent, EventSink};
use domain::GapStatus;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Wry};
use tauri_specta::Event;

use super::dto::{
    DegradedReasonDto, FocusDto, IdleGapDto, IdleResolutionDto, PermissionStateDto,
    ShortcutStatusDto, TrackingStatusDto, UpdateInfoDto,
};

/// Shortcut state shared between the commands, the shortcut registrar and this sink.
pub type SharedShortcut = Arc<Mutex<ShortcutStatusDto>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum DataKindDto {
    Segments,
    Gaps,
}

impl From<DataKind> for DataKindDto {
    fn from(k: DataKind) -> Self {
        match k {
            DataKind::Segments => Self::Segments,
            DataKind::Gaps => Self::Gaps,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GapStatusDto {
    Pending,
    Resolved { resolution: IdleResolutionDto },
    Expired,
}

impl From<GapStatus> for GapStatusDto {
    fn from(s: GapStatus) -> Self {
        match s {
            GapStatus::Pending => Self::Pending,
            GapStatus::Expired => Self::Expired,
            GapStatus::Resolved(r) => Self::Resolved {
                resolution: match r {
                    domain::IdleResolution::Discard => IdleResolutionDto::Discard,
                    domain::IdleResolution::AssignPrevious => IdleResolutionDto::AssignPrevious,
                    domain::IdleResolution::AssignActivity(id) => {
                        IdleResolutionDto::AssignActivity { activity_id: id.0 }
                    }
                },
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
pub struct TrackingStatusChanged(pub TrackingStatusDto);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
pub struct CurrentSegmentChanged(pub Option<FocusDto>);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
pub struct IdleGapPending(pub IdleGapDto);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
pub struct IdleGapResolved {
    pub id: i64,
    pub status: GapStatusDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
pub struct PermissionChanged {
    pub state: PermissionStateDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
pub struct ShortcutStatusChanged(pub ShortcutStatusDto);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
pub struct DataChanged {
    pub kind: DataKindDto,
}

/// A persistence call failed; the engine keeps running (the frontend may show a notice).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
pub struct StorageFailed {
    pub message: String,
}

/// The updater found a newer signed release; the UI offers to install it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
pub struct UpdateAvailable(pub UpdateInfoDto);

/// Everything the backend can push, as one value so translation is testable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppEvent {
    TrackingStatusChanged(TrackingStatusChanged),
    CurrentSegmentChanged(CurrentSegmentChanged),
    IdleGapPending(IdleGapPending),
    IdleGapResolved(IdleGapResolved),
    PermissionChanged(PermissionChanged),
    ShortcutStatusChanged(ShortcutStatusChanged),
    DataChanged(DataChanged),
    StorageFailed(StorageFailed),
}

impl AppEvent {
    pub fn emit(&self, app: &AppHandle<Wry>) -> tauri::Result<()> {
        match self {
            Self::TrackingStatusChanged(e) => e.emit(app),
            Self::CurrentSegmentChanged(e) => e.emit(app),
            Self::IdleGapPending(e) => e.emit(app),
            Self::IdleGapResolved(e) => e.emit(app),
            Self::PermissionChanged(e) => e.emit(app),
            Self::ShortcutStatusChanged(e) => e.emit(app),
            Self::DataChanged(e) => e.emit(app),
            Self::StorageFailed(e) => e.emit(app),
        }
    }
}

/// Turns an engine fact into the frontend events it implies. A pending gap without a
/// repository id cannot be resolved by the UI, so it produces no event.
pub fn translate(
    event: DomainEvent,
    shortcut: &ShortcutStatusDto,
    degraded_reason: DegradedReasonDto,
) -> Vec<AppEvent> {
    match event {
        DomainEvent::TrackingStatusChanged(status) => {
            vec![AppEvent::TrackingStatusChanged(TrackingStatusChanged(
                TrackingStatusDto::new(status, shortcut.clone(), degraded_reason),
            ))]
        }
        DomainEvent::CurrentSegmentChanged(focus) => vec![AppEvent::CurrentSegmentChanged(
            CurrentSegmentChanged(focus.map(Into::into)),
        )],
        DomainEvent::IdleGapPending(gap) => IdleGapDto::from_gap(gap)
            .map(|dto| vec![AppEvent::IdleGapPending(IdleGapPending(dto))])
            .unwrap_or_default(),
        DomainEvent::IdleGapResolved { id, status } => {
            vec![AppEvent::IdleGapResolved(IdleGapResolved {
                id: id.0,
                status: status.into(),
            })]
        }
        DomainEvent::PermissionChanged(state) => {
            vec![AppEvent::PermissionChanged(PermissionChanged {
                state: state.into(),
            })]
        }
        DomainEvent::DataChanged(kind) => {
            vec![AppEvent::DataChanged(DataChanged { kind: kind.into() })]
        }
        DomainEvent::StorageFailed(message) => {
            vec![AppEvent::StorageFailed(StorageFailed { message })]
        }
    }
}

/// Engine `EventSink` that emits typed events to every window.
pub struct TauriEventSink {
    app: AppHandle<Wry>,
    shortcut: SharedShortcut,
    degraded_reason: DegradedReasonDto,
}

impl TauriEventSink {
    pub fn new(
        app: AppHandle<Wry>,
        shortcut: SharedShortcut,
        degraded_reason: DegradedReasonDto,
    ) -> Self {
        Self {
            app,
            shortcut,
            degraded_reason,
        }
    }
}

impl EventSink for TauriEventSink {
    fn emit(&self, event: DomainEvent) {
        let shortcut = self
            .shortcut
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        for app_event in translate(event, &shortcut, self.degraded_reason) {
            // Emitting is best effort: a window that is closing must not stop the engine.
            let _ = app_event.emit(&self.app);
        }
    }
}

#[cfg(test)]
mod tests {
    use application::ports::{TrackingKind, TrackingStatus};
    use domain::{
        ActivityId, FocusSnapshot, GapId, IdleGap, IdleResolution, PermissionState, UtcMs,
    };

    use super::*;

    fn gap(id: Option<i64>) -> IdleGap {
        IdleGap {
            id: id.map(GapId),
            started_at: UtcMs(1),
            ended_at: UtcMs(2),
            prev_focus: None,
            status: GapStatus::Pending,
            expires_at: UtcMs(3),
        }
    }

    #[test]
    fn storage_failures_become_an_event() {
        let events = translate(
            DomainEvent::StorageFailed("disk full".into()),
            &ShortcutStatusDto::Disabled,
            DegradedReasonDto::AccessibilityDenied,
        );
        assert_eq!(
            events,
            vec![AppEvent::StorageFailed(StorageFailed {
                message: "disk full".into()
            })]
        );
    }

    #[test]
    fn status_change_carries_the_current_shortcut_state() {
        let shortcut = ShortcutStatusDto::Unavailable {
            shortcut: "⌃⌥⌘T".into(),
            reason: "in use".into(),
        };
        let events = translate(
            DomainEvent::TrackingStatusChanged(TrackingStatus {
                kind: TrackingKind::Paused,
                current: None,
                since: None,
                degraded: false,
            }),
            &shortcut,
            DegradedReasonDto::AccessibilityDenied,
        );
        let [AppEvent::TrackingStatusChanged(TrackingStatusChanged(dto))] = events.as_slice()
        else {
            panic!("expected one status event, got {events:?}");
        };
        assert_eq!(dto.shortcut, shortcut);
    }

    #[test]
    fn pending_gap_event_needs_a_repository_id() {
        assert!(
            translate(
                DomainEvent::IdleGapPending(gap(None)),
                &ShortcutStatusDto::Disabled,
                DegradedReasonDto::AccessibilityDenied
            )
            .is_empty()
        );
        let events = translate(
            DomainEvent::IdleGapPending(gap(Some(4))),
            &ShortcutStatusDto::Disabled,
            DegradedReasonDto::AccessibilityDenied,
        );
        assert!(matches!(
            events.as_slice(),
            [AppEvent::IdleGapPending(IdleGapPending(dto))] if dto.id == 4
        ));
    }

    #[test]
    fn resolved_gap_reports_how_it_was_resolved() {
        let events = translate(
            DomainEvent::IdleGapResolved {
                id: GapId(4),
                status: GapStatus::Resolved(IdleResolution::AssignActivity(ActivityId(2))),
            },
            &ShortcutStatusDto::Disabled,
            DegradedReasonDto::AccessibilityDenied,
        );
        assert_eq!(
            events,
            vec![AppEvent::IdleGapResolved(IdleGapResolved {
                id: 4,
                status: GapStatusDto::Resolved {
                    resolution: IdleResolutionDto::AssignActivity { activity_id: 2 }
                }
            })]
        );
        assert_eq!(
            GapStatusDto::from(GapStatus::Expired),
            GapStatusDto::Expired
        );
    }

    #[test]
    fn permission_focus_and_data_events_map_one_to_one() {
        let none = ShortcutStatusDto::Disabled;
        assert_eq!(
            translate(
                DomainEvent::PermissionChanged(PermissionState::Denied),
                &none,
                DegradedReasonDto::AccessibilityDenied
            ),
            vec![AppEvent::PermissionChanged(PermissionChanged {
                state: PermissionStateDto::Denied
            })]
        );
        assert_eq!(
            translate(
                DomainEvent::DataChanged(DataKind::Gaps),
                &none,
                DegradedReasonDto::AccessibilityDenied
            ),
            vec![AppEvent::DataChanged(DataChanged {
                kind: DataKindDto::Gaps
            })]
        );
        let focus = FocusSnapshot {
            app_id: "a".into(),
            app_name: "A".into(),
            pid: 1,
            window_title: None,
        };
        let events = translate(
            DomainEvent::CurrentSegmentChanged(Some(focus)),
            &none,
            DegradedReasonDto::AccessibilityDenied,
        );
        assert!(matches!(
            events.as_slice(),
            [AppEvent::CurrentSegmentChanged(CurrentSegmentChanged(Some(f)))] if f.app_id == "a"
        ));
    }
}
