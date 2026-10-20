//! Windows adapters (design sections 5 and 6), mirroring `adapters-macos`:
//!
//! - foreground window: `GetForegroundWindow` polled on every sampler tick plus an
//!   `EVENT_SYSTEM_FOREGROUND` WinEvent hook that reports switches immediately,
//! - title: `GetWindowTextW` (reads the cached caption, never blocks on a hung window),
//! - application: `GetWindowThreadProcessId` + `QueryFullProcessImageNameW`, named after the
//!   executable's `FileDescription` when it has one,
//! - idle: `GetLastInputInfo` + `GetTickCount64`,
//! - lock/unlock (`WM_WTSSESSION_CHANGE`) and sleep/wake (`WM_POWERBROADCAST`) on a hidden
//!   window owned by the same message-loop thread as the hook.
//!
//! None of these APIs needs a user permission, so the permission provider always answers
//! `Granted`. Everything that calls Win32 is behind `cfg(windows)`; the mapping and parsing
//! helpers are plain Rust and tested on every platform.

pub mod events;
pub mod idle;
pub mod naming;

#[cfg(windows)]
mod foreground;
#[cfg(windows)]
mod message_loop;
#[cfg(windows)]
mod platform;

#[cfg(windows)]
pub use platform::{WinEnv, WinPermission, WindowsPlatform};
