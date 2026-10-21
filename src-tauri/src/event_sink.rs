//! The engine's event sink in production: forwards every fact to the frontend (typed events)
//! and performs the shell side effects the facts imply (design section 11): open the popover
//! when an idle gap needs a decision, keep the tray menu and the tray text in step with the
//! tracking state and the recorded time.

use application::ports::DataKind;
use application::ports::{DomainEvent, EventSink, TrackingKind};
use tauri::{AppHandle, Manager, Wry};

use crate::focus_watcher::FocusWatcher;
use crate::goal_watcher::GoalWatcher;
use crate::ipc::dto::DegradedReasonDto;
use crate::ipc::events::{SharedShortcut, TauriEventSink};
use crate::tray_text::TrayText;
use crate::{tray, windows};

/// A shell-level consequence of an engine event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellAction {
    /// Idle gap pending: show the decision card (R3.4); also the fallback when system
    /// notifications are not authorized (R5.5).
    ShowPopover,
    /// Tracking state changed: refresh the Pause/Resume tray entry.
    TrackingState(TrackingKind),
    /// Status or recorded time changed: recompute the text next to the tray icon.
    RefreshTrayText,
    /// Status or recorded time changed: the goal watcher looks at the goals again.
    RefreshGoals,
    /// The app in front or the tracking state changed: the focus session looks again.
    RefreshFocus,
}

/// Pure mapping from engine events to shell actions.
pub fn actions_for(event: &DomainEvent) -> Vec<ShellAction> {
    match event {
        DomainEvent::IdleGapPending(_) => vec![ShellAction::ShowPopover],
        DomainEvent::TrackingStatusChanged(status) => vec![
            ShellAction::TrackingState(status.kind),
            ShellAction::RefreshTrayText,
            ShellAction::RefreshGoals,
            ShellAction::RefreshFocus,
        ],
        DomainEvent::CurrentSegmentChanged(_) => vec![
            ShellAction::RefreshTrayText,
            ShellAction::RefreshGoals,
            ShellAction::RefreshFocus,
        ],
        DomainEvent::DataChanged(DataKind::Segments) => {
            vec![ShellAction::RefreshTrayText, ShellAction::RefreshGoals]
        }
        _ => Vec::new(),
    }
}

/// Executes [`ShellAction`]s; faked in tests.
pub trait Shell: Send {
    fn perform(&self, action: ShellAction);
}

/// Real shell: windows and tray of the running Tauri app.
pub struct TauriShell {
    app: AppHandle<Wry>,
}

impl TauriShell {
    pub fn new(app: AppHandle<Wry>) -> Self {
        Self { app }
    }
}

impl Shell for TauriShell {
    fn perform(&self, action: ShellAction) {
        match action {
            ShellAction::ShowPopover => windows::show_popover(&self.app),
            ShellAction::TrackingState(kind) => tray::set_tracking_state(&self.app, kind),
            // Non-blocking: the worker thread does the reading and the main-thread hop.
            ShellAction::RefreshTrayText => {
                if let Some(tray_text) = self.app.try_state::<TrayText>() {
                    tray_text.refresh();
                }
            }
            ShellAction::RefreshGoals => {
                if let Some(goals) = self.app.try_state::<GoalWatcher>() {
                    goals.refresh();
                }
            }
            ShellAction::RefreshFocus => {
                if let Some(focus) = self.app.try_state::<FocusWatcher>() {
                    focus.refresh();
                }
            }
        }
    }
}

pub struct ShellEventSink<I: EventSink, S: Shell> {
    inner: I,
    shell: S,
}

impl<I: EventSink, S: Shell> ShellEventSink<I, S> {
    pub fn new(inner: I, shell: S) -> Self {
        Self { inner, shell }
    }
}

impl<I: EventSink, S: Shell> EventSink for ShellEventSink<I, S> {
    fn emit(&self, event: DomainEvent) {
        let actions = actions_for(&event);
        // Frontend first, so a window opened by the action already finds the event delivered.
        self.inner.emit(event);
        for action in actions {
            self.shell.perform(action);
        }
    }
}

/// Production sink for `app`. `degraded_reason` explains a degraded status on this platform.
pub fn tauri_sink(
    app: &AppHandle<Wry>,
    shortcut: SharedShortcut,
    degraded_reason: DegradedReasonDto,
) -> ShellEventSink<TauriEventSink, TauriShell> {
    ShellEventSink::new(
        TauriEventSink::new(app.clone(), shortcut, degraded_reason),
        TauriShell::new(app.clone()),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use application::fakes::RecordingSink;
    use application::ports::TrackingStatus;
    use domain::{GapId, GapStatus, IdleGap, UtcMs};

    use super::*;

    fn gap() -> IdleGap {
        IdleGap {
            id: Some(GapId(1)),
            started_at: UtcMs(1),
            ended_at: UtcMs(2),
            prev_focus: None,
            status: GapStatus::Pending,
            expires_at: UtcMs(3),
        }
    }

    fn status(kind: TrackingKind) -> TrackingStatus {
        TrackingStatus {
            kind,
            current: None,
            since: None,
            degraded: false,
        }
    }

    #[derive(Clone, Default)]
    struct RecordingShell(Arc<Mutex<Vec<ShellAction>>>);

    impl Shell for RecordingShell {
        fn perform(&self, action: ShellAction) {
            self.0.lock().unwrap().push(action);
        }
    }

    #[test]
    fn a_pending_idle_gap_opens_the_popover() {
        assert_eq!(
            actions_for(&DomainEvent::IdleGapPending(gap())),
            vec![ShellAction::ShowPopover]
        );
    }

    #[test]
    fn status_changes_refresh_the_tray_entry_and_text() {
        assert_eq!(
            actions_for(&DomainEvent::TrackingStatusChanged(status(
                TrackingKind::Paused
            ))),
            vec![
                ShellAction::TrackingState(TrackingKind::Paused),
                ShellAction::RefreshTrayText,
                ShellAction::RefreshGoals,
                ShellAction::RefreshFocus
            ]
        );
    }

    #[test]
    fn segment_changes_refresh_the_tray_text_and_the_goals() {
        assert_eq!(
            actions_for(&DomainEvent::DataChanged(DataKind::Segments)),
            vec![ShellAction::RefreshTrayText, ShellAction::RefreshGoals]
        );
    }

    #[test]
    fn the_app_in_front_changing_also_wakes_the_focus_session() {
        assert_eq!(
            actions_for(&DomainEvent::CurrentSegmentChanged(None)),
            vec![
                ShellAction::RefreshTrayText,
                ShellAction::RefreshGoals,
                ShellAction::RefreshFocus
            ]
        );
    }

    #[test]
    fn other_events_have_no_shell_side_effect() {
        for event in [
            DomainEvent::DataChanged(DataKind::Gaps),
            DomainEvent::StorageFailed("x".into()),
        ] {
            assert!(actions_for(&event).is_empty());
        }
    }

    #[test]
    fn the_sink_forwards_the_event_and_then_runs_the_actions() {
        let inner = RecordingSink::default();
        let shell = RecordingShell::default();
        let sink = ShellEventSink::new(inner.clone(), shell.clone());
        sink.emit(DomainEvent::IdleGapPending(gap()));
        sink.emit(DomainEvent::DataChanged(DataKind::Gaps));
        assert_eq!(inner.events().len(), 2);
        assert_eq!(*shell.0.lock().unwrap(), vec![ShellAction::ShowPopover]);
    }
}
