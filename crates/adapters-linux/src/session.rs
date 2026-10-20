//! Which tracking mode a Linux session supports. Decided once at startup from the
//! environment and one X11 probe; pure, so it is tested on every platform.

use application::ports::DegradedReason;

/// How the tracker observes this session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisplayMode {
    /// A real X server with EWMH: focus, titles and idle through X11.
    X11,
    /// Wayland without a usable X11 view of the focused window: no window tracking, idle
    /// over D-Bus.
    Wayland,
    /// No display server at all (headless, SSH, CI): nothing to observe.
    NoDisplay,
}

/// Result of probing `$DISPLAY`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum X11Probe {
    /// No X server could be reached.
    Unavailable,
    /// Connected, but the server is Xwayland (it only sees X11 clients) or no window is
    /// reported in `_NET_ACTIVE_WINDOW`.
    NoUsableActiveWindow,
    /// Connected to a server that reports the active window.
    ActiveWindow,
}

/// `WAYLAND_DISPLAY` is set, or logind says the session type is Wayland.
pub fn is_wayland_session(wayland_display: Option<&str>, session_type: Option<&str>) -> bool {
    wayland_display.is_some_and(|d| !d.trim().is_empty())
        || session_type.is_some_and(|t| t.trim().eq_ignore_ascii_case("wayland"))
}

/// On a plain X11 session the X11 mode is used even before a window has the focus. On
/// Wayland it is used only when X11 really reports the active window: Xwayland sees only X11
/// clients, so trusting it would attribute time spent in native Wayland windows to the
/// last X11 window.
pub fn decide(wayland: bool, probe: X11Probe) -> DisplayMode {
    match (wayland, probe) {
        (_, X11Probe::ActiveWindow) | (false, X11Probe::NoUsableActiveWindow) => DisplayMode::X11,
        (true, _) => DisplayMode::Wayland,
        (false, X11Probe::Unavailable) => DisplayMode::NoDisplay,
    }
}

/// The probe outcome from what the X11 connection reported.
pub fn probe_from(connected: bool, is_xwayland: bool, has_active_window: bool) -> X11Probe {
    match (connected, is_xwayland, has_active_window) {
        (false, _, _) => X11Probe::Unavailable,
        (true, false, true) => X11Probe::ActiveWindow,
        (true, _, _) => X11Probe::NoUsableActiveWindow,
    }
}

/// Why the mode degrades tracking, for the UI banner; `None` when nothing is degraded.
pub fn degraded_reason(mode: DisplayMode) -> Option<DegradedReason> {
    match mode {
        DisplayMode::X11 => None,
        DisplayMode::Wayland => Some(DegradedReason::WaylandSession),
        DisplayMode::NoDisplay => Some(DegradedReason::NoDisplay),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wayland_is_detected_from_the_socket_or_the_session_type() {
        assert!(is_wayland_session(Some("wayland-0"), None));
        assert!(is_wayland_session(None, Some("wayland")));
        assert!(is_wayland_session(Some(""), Some("Wayland")));
        assert!(!is_wayland_session(Some("  "), Some("x11")));
        assert!(!is_wayland_session(None, None));
    }

    #[test]
    fn x11_sessions_track_through_x11_even_without_focus_yet() {
        assert_eq!(decide(false, X11Probe::ActiveWindow), DisplayMode::X11);
        assert_eq!(
            decide(false, X11Probe::NoUsableActiveWindow),
            DisplayMode::X11
        );
    }

    #[test]
    fn wayland_needs_a_real_active_window_to_use_x11() {
        assert_eq!(decide(true, X11Probe::ActiveWindow), DisplayMode::X11);
        assert_eq!(
            decide(true, X11Probe::NoUsableActiveWindow),
            DisplayMode::Wayland
        );
        assert_eq!(decide(true, X11Probe::Unavailable), DisplayMode::Wayland);
    }

    #[test]
    fn no_server_at_all_is_no_display() {
        assert_eq!(decide(false, X11Probe::Unavailable), DisplayMode::NoDisplay);
    }

    #[test]
    fn xwayland_is_never_a_usable_active_window() {
        assert_eq!(probe_from(false, false, true), X11Probe::Unavailable);
        assert_eq!(probe_from(true, true, true), X11Probe::NoUsableActiveWindow);
        assert_eq!(
            probe_from(true, false, false),
            X11Probe::NoUsableActiveWindow
        );
        assert_eq!(probe_from(true, false, true), X11Probe::ActiveWindow);
    }

    #[test]
    fn only_non_x11_modes_are_degraded() {
        assert_eq!(degraded_reason(DisplayMode::X11), None);
        assert_eq!(
            degraded_reason(DisplayMode::Wayland),
            Some(DegradedReason::WaylandSession)
        );
        assert_eq!(
            degraded_reason(DisplayMode::NoDisplay),
            Some(DegradedReason::NoDisplay)
        );
    }
}
