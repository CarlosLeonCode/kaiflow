//! Linux adapters (design sections 5 and 6), mirroring `adapters-macos`:
//!
//! - X11 sessions: the active window from `_NET_ACTIVE_WINDOW` on the root window (polled on
//!   every sampler tick plus `PropertyNotify` events for immediate switches), its title from
//!   `_NET_WM_NAME` (UTF-8) or `WM_NAME`, the application from `WM_CLASS` and `_NET_WM_PID`,
//!   and idle time from the MIT-SCREEN-SAVER extension. All through `x11rb` (pure Rust).
//! - Sleep/wake and lock/unlock from logind over D-Bus (`logind` feature, default on).
//! - Wayland sessions do not let a client observe other applications' windows. When no
//!   usable X11 active window exists the tracker reports a degraded state with the
//!   `WaylandSession` reason (the UI explains it); idle detection still works through
//!   `org.gnome.Mutter.IdleMonitor` or the logind `IdleHint`.
//!
//! Nothing here panics or spins without a display: a missing server degrades the mode and
//! listener threads end when their connection does.
//!
//! The parsing and decision helpers are plain Rust, tested on every platform.

pub mod logind;
pub mod naming;
pub mod session;

#[cfg(all(target_os = "linux", feature = "logind"))]
pub mod dbus;
#[cfg(target_os = "linux")]
mod platform;
#[cfg(target_os = "linux")]
pub mod x11;

#[cfg(target_os = "linux")]
pub use platform::{IdleSource, LinuxEnv, LinuxPermission, LinuxPlatform};
