//! Window messages that map to engine signals. The numeric values are the documented Win32
//! constants, repeated here so the mapping is tested on every platform; a Windows-only test
//! checks them against the `windows` crate.

use application::ports::SystemSignal;

pub const WM_ENDSESSION: u32 = 0x0016;
pub const WM_POWERBROADCAST: u32 = 0x0218;
pub const WM_WTSSESSION_CHANGE: u32 = 0x02B1;

pub const PBT_APMSUSPEND: usize = 0x0004;
/// Sent on every resume, with or without user input (unlike `PBT_APMRESUMESUSPEND`, which
/// would report the same wake twice).
pub const PBT_APMRESUMEAUTOMATIC: usize = 0x0012;

pub const WTS_SESSION_LOCK: usize = 0x7;
pub const WTS_SESSION_UNLOCK: usize = 0x8;

/// `idObject` of a WinEvent that concerns the window itself (`OBJID_WINDOW`).
pub const OBJID_WINDOW: i32 = 0;

/// Maps a message received by the hidden event window; `None` for everything else.
pub fn signal_for_message(message: u32, wparam: usize) -> Option<SystemSignal> {
    match (message, wparam) {
        (WM_POWERBROADCAST, PBT_APMSUSPEND) => Some(SystemSignal::WillSleep),
        (WM_POWERBROADCAST, PBT_APMRESUMEAUTOMATIC) => Some(SystemSignal::DidWake),
        (WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK) => Some(SystemSignal::ScreenLocked),
        (WM_WTSSESSION_CHANGE, WTS_SESSION_UNLOCK) => Some(SystemSignal::ScreenUnlocked),
        // `wParam` is TRUE when the session is really ending (log off, shut down, restart).
        (WM_ENDSESSION, ending) if ending != 0 => Some(SystemSignal::PowerOff),
        _ => None,
    }
}

/// Whether a WinEvent callback describes a foreground change worth reading.
pub fn is_foreground_change(event: u32, id_object: i32, has_window: bool) -> bool {
    const EVENT_SYSTEM_FOREGROUND: u32 = 0x0003;
    event == EVENT_SYSTEM_FOREGROUND && id_object == OBJID_WINDOW && has_window
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn power_and_session_messages_map_to_signals() {
        let cases = [
            (
                WM_POWERBROADCAST,
                PBT_APMSUSPEND,
                Some(SystemSignal::WillSleep),
            ),
            (
                WM_POWERBROADCAST,
                PBT_APMRESUMEAUTOMATIC,
                Some(SystemSignal::DidWake),
            ),
            (
                WM_WTSSESSION_CHANGE,
                WTS_SESSION_LOCK,
                Some(SystemSignal::ScreenLocked),
            ),
            (
                WM_WTSSESSION_CHANGE,
                WTS_SESSION_UNLOCK,
                Some(SystemSignal::ScreenUnlocked),
            ),
            (WM_ENDSESSION, 1, Some(SystemSignal::PowerOff)),
        ];
        for (message, wparam, expected) in cases {
            assert_eq!(signal_for_message(message, wparam), expected);
        }
    }

    #[test]
    fn other_messages_and_parameters_are_ignored() {
        // PBT_APMRESUMESUSPEND (7) duplicates the automatic resume.
        assert_eq!(signal_for_message(WM_POWERBROADCAST, 0x7), None);
        // PBT_POWERSETTINGCHANGE.
        assert_eq!(signal_for_message(WM_POWERBROADCAST, 0x8013), None);
        // WTS_SESSION_LOGON.
        assert_eq!(signal_for_message(WM_WTSSESSION_CHANGE, 0x5), None);
        // The end-session query was cancelled.
        assert_eq!(signal_for_message(WM_ENDSESSION, 0), None);
        assert_eq!(signal_for_message(0x0001, PBT_APMSUSPEND), None);
    }

    #[test]
    fn only_window_level_foreground_events_count() {
        assert!(is_foreground_change(3, OBJID_WINDOW, true));
        assert!(!is_foreground_change(3, OBJID_WINDOW, false));
        assert!(!is_foreground_change(3, -4, true));
        assert!(!is_foreground_change(0x800C, OBJID_WINDOW, true));
    }

    #[cfg(windows)]
    #[test]
    fn the_constants_match_the_windows_crate() {
        use windows::Win32::UI::WindowsAndMessaging as wm;
        assert_eq!(WM_ENDSESSION, wm::WM_ENDSESSION);
        assert_eq!(WM_POWERBROADCAST, wm::WM_POWERBROADCAST);
        assert_eq!(WM_WTSSESSION_CHANGE, wm::WM_WTSSESSION_CHANGE);
        assert_eq!(PBT_APMSUSPEND, wm::PBT_APMSUSPEND as usize);
        assert_eq!(PBT_APMRESUMEAUTOMATIC, wm::PBT_APMRESUMEAUTOMATIC as usize);
        assert_eq!(WTS_SESSION_LOCK, wm::WTS_SESSION_LOCK as usize);
        assert_eq!(WTS_SESSION_UNLOCK, wm::WTS_SESSION_UNLOCK as usize);
        assert_eq!(OBJID_WINDOW, wm::OBJID_WINDOW.0);
        assert!(is_foreground_change(
            wm::EVENT_SYSTEM_FOREGROUND,
            wm::OBJID_WINDOW.0,
            true
        ));
    }
}
