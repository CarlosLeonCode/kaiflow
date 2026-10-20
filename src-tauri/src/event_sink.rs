//! The engine's event sink in production: forwards every fact to the frontend (typed events)
//! and performs the shell side effects the facts imply (design section 11): open the popover
//! when an idle gap needs a decision, keep the tray menu in step with the tracking state.

use application::ports::{DomainEvent, EventSink, TrackingKind};
use tauri::{AppHandle, Wry};

use crate::ipc::events::{SharedShortcut, TauriEventSink};
use crate::{tray, windows};

/// A shell-level consequence of an engine event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellAction {
    /// Idle gap pending: show the decision card (R3.4); also the fallback when system
    /// notifications are not authorized (R5.5).
    ShowPopover,
    /// Tracking state changed: refresh the Pause/Resume tray entry.
    TrackingState(TrackingKind),
}

/// Pure mapping from engine events to shell actions.
pub fn actions_for(event: &DomainEvent) -> Vec<ShellAction> {
    match event {
        DomainEvent::IdleGapPending(_) => vec![ShellAction::ShowPopover],
        DomainEvent::TrackingStatusChanged(status) => {
            vec![ShellAction::TrackingState(status.kind)]
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

/// Production sink for `app`.
pub fn tauri_sink(
    app: &AppHandle<Wry>,
    shortcut: SharedShortcut,
) -> ShellEventSink<TauriEventSink, TauriShell> {
    ShellEventSink::new(
        TauriEventSink::new(app.clone(), shortcut),
        TauriShell::new(app.clone()),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use application::fakes::RecordingSink;
    use application::ports::{DataKind, TrackingStatus};
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
    fn status_changes_refresh_the_tray_entry() {
        assert_eq!(
            actions_for(&DomainEvent::TrackingStatusChanged(status(
                TrackingKind::Paused
            ))),
            vec![ShellAction::TrackingState(TrackingKind::Paused)]
        );
    }

    #[test]
    fn other_events_have_no_shell_side_effect() {
        for event in [
            DomainEvent::DataChanged(DataKind::Segments),
            DomainEvent::StorageFailed("x".into()),
            DomainEvent::CurrentSegmentChanged(None),
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
