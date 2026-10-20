//! Last-resort stand-ins for the OS providers, used only when no native adapter can run
//! (an unsupported OS, or macOS when `platform::providers` is not on the main thread) and as
//! the base for tests. The app and the whole IPC surface keep working, but nothing observes
//! the real desktop.

use application::ports::{
    ActiveWindowProvider, IdleProvider, Notifier, PermissionProvider, PowerEventsProvider,
    SystemSignal,
};
use crossbeam_channel::Sender;
use domain::{FocusSnapshot, IdleGap, PermissionState};

/// Reports no focused window, so `Start` opens no segment until the real observer lands.
pub struct NoActiveWindow;

impl ActiveWindowProvider for NoActiveWindow {
    fn current(&self) -> Option<FocusSnapshot> {
        None
    }
}

/// Always active, so no idle gap is ever detected.
pub struct NoIdle;

impl IdleProvider for NoIdle {
    fn seconds_since_input(&self) -> f64 {
        0.0
    }
}

/// Never delivers sleep, wake, lock or power-off signals.
pub struct NoPowerEvents;

impl PowerEventsProvider for NoPowerEvents {
    fn subscribe(&self, _tx: Sender<SystemSignal>) {}
}

/// Pretends Accessibility is granted; the real check needs `AXIsProcessTrusted`.
pub struct AssumeGranted;

impl PermissionProvider for AssumeGranted {
    fn accessibility(&self) -> PermissionState {
        PermissionState::Granted
    }
    fn request(&self) {}
    fn open_settings(&self) {}
}

/// Drops notifications; the popover still opens on `idle-gap-pending` in a later task.
pub struct SilentNotifier;

impl Notifier for SilentNotifier {
    fn idle_return(&self, _gap: &IdleGap) {}
    fn permission_revoked(&self) {}
}
