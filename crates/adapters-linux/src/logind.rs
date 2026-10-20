//! logind (and GNOME Mutter) facts mapped to engine signals and idle seconds. Pure, so it is
//! tested on every platform; the D-Bus plumbing lives in `dbus.rs`.

use application::ports::SystemSignal;

pub const LOGIND_BUS_NAME: &str = "org.freedesktop.login1";
pub const MANAGER_PATH: &str = "/org/freedesktop/login1";
pub const MANAGER_INTERFACE: &str = "org.freedesktop.login1.Manager";
pub const SESSION_INTERFACE: &str = "org.freedesktop.login1.Session";

pub const MUTTER_IDLE_BUS_NAME: &str = "org.gnome.Mutter.IdleMonitor";
pub const MUTTER_IDLE_PATH: &str = "/org/gnome/Mutter/IdleMonitor/Core";
pub const MUTTER_IDLE_INTERFACE: &str = "org.gnome.Mutter.IdleMonitor";

/// `PrepareForSleep(true)` before suspend, `(false)` after resume; `PrepareForShutdown(true)`
/// before power-off (a `false` means the shutdown was cancelled and needs no signal).
pub fn manager_signal(member: &str, active: bool) -> Option<SystemSignal> {
    match (member, active) {
        ("PrepareForSleep", true) => Some(SystemSignal::WillSleep),
        ("PrepareForSleep", false) => Some(SystemSignal::DidWake),
        ("PrepareForShutdown", true) => Some(SystemSignal::PowerOff),
        _ => None,
    }
}

/// `Lock` / `Unlock` on the session object (sent by `loginctl lock-session` and by desktops
/// that lock through logind).
pub fn session_signal(member: &str) -> Option<SystemSignal> {
    match member {
        "Lock" => Some(SystemSignal::ScreenLocked),
        "Unlock" => Some(SystemSignal::ScreenUnlocked),
        _ => None,
    }
}

/// `LockedHint` property changes: GNOME and KDE set it when their own lock screen shows,
/// even when no `Lock` signal was sent. Duplicates with `Lock` are harmless (the engine
/// treats a second lock as a no-op).
pub fn locked_hint_signal(locked: bool) -> SystemSignal {
    if locked {
        SystemSignal::ScreenLocked
    } else {
        SystemSignal::ScreenUnlocked
    }
}

/// `org.gnome.Mutter.IdleMonitor.GetIdletime` answers in milliseconds.
pub fn idle_from_mutter(idle_ms: u64) -> f64 {
    // Precision loss above 2^53 ms is irrelevant.
    #[allow(clippy::cast_precision_loss)]
    let ms = idle_ms as f64;
    ms / 1000.0
}

/// logind's `IdleHint` / `IdleSinceHint` (CLOCK_REALTIME, microseconds). The desktop sets
/// the hint after its own idle delay, so this is coarser than a real input counter.
pub fn idle_from_logind(idle_hint: bool, idle_since_us: u64, now_us: u64) -> f64 {
    if !idle_hint || idle_since_us == 0 {
        return 0.0;
    }
    #[allow(clippy::cast_precision_loss)]
    let us = now_us.saturating_sub(idle_since_us) as f64;
    us / 1_000_000.0
}

/// X11 MIT-SCREEN-SAVER `ms_since_user_input`.
pub fn idle_from_x11(ms_since_user_input: u32) -> f64 {
    f64::from(ms_since_user_input) / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sleep_and_shutdown_map_to_engine_signals() {
        assert_eq!(
            manager_signal("PrepareForSleep", true),
            Some(SystemSignal::WillSleep)
        );
        assert_eq!(
            manager_signal("PrepareForSleep", false),
            Some(SystemSignal::DidWake)
        );
        assert_eq!(
            manager_signal("PrepareForShutdown", true),
            Some(SystemSignal::PowerOff)
        );
        assert_eq!(manager_signal("PrepareForShutdown", false), None);
        assert_eq!(manager_signal("SessionNew", true), None);
    }

    #[test]
    fn lock_signals_and_hint_map_to_engine_signals() {
        assert_eq!(session_signal("Lock"), Some(SystemSignal::ScreenLocked));
        assert_eq!(session_signal("Unlock"), Some(SystemSignal::ScreenUnlocked));
        assert_eq!(session_signal("PauseDevice"), None);
        assert_eq!(locked_hint_signal(true), SystemSignal::ScreenLocked);
        assert_eq!(locked_hint_signal(false), SystemSignal::ScreenUnlocked);
    }

    #[test]
    fn idle_sources_convert_to_seconds() {
        assert!((idle_from_mutter(12_500) - 12.5).abs() < f64::EPSILON);
        assert!((idle_from_x11(1_500) - 1.5).abs() < f64::EPSILON);
        assert!((idle_from_logind(true, 1_000_000, 61_000_000) - 60.0).abs() < f64::EPSILON);
    }

    #[test]
    fn logind_idle_is_zero_without_the_hint_or_with_a_future_timestamp() {
        assert_eq!(idle_from_logind(false, 1_000_000, 61_000_000), 0.0);
        assert_eq!(idle_from_logind(true, 0, 61_000_000), 0.0);
        assert_eq!(idle_from_logind(true, 70_000_000, 61_000_000), 0.0);
    }
}
