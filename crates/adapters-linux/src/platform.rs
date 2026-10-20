//! What the composition root wires on Linux: the session mode, the sampler environment, the
//! activation stream, the logind fan-out and the permission provider.

use std::sync::Arc;

use adapters_common::activation::Activation;
use adapters_common::fanout::SignalFanout;
use adapters_common::sampler::SamplerEnv;
use application::ports::{DegradedReason, PermissionProvider};
use crossbeam_channel::{Receiver, bounded};
use domain::PermissionState;

use crate::session::{DisplayMode, decide, degraded_reason, is_wayland_session, probe_from};
use crate::x11::{X11, spawn_listener};

/// Pending activations kept for the sampler; older ones are irrelevant (it polls anyway).
const ACTIVATION_QUEUE: usize = 64;

/// Idle time when X11 cannot provide it (Wayland): GNOME Mutter or logind over D-Bus.
#[cfg(feature = "logind")]
pub type IdleSource = crate::dbus::DbusIdle;

/// Without D-Bus there is no idle source outside X11.
#[cfg(not(feature = "logind"))]
#[derive(Debug, Default)]
pub struct IdleSource;

#[cfg(not(feature = "logind"))]
impl IdleSource {
    pub fn connect() -> Self {
        Self
    }
    pub fn seconds_since_input(&self) -> f64 {
        0.0
    }
}

/// Sampler environment for the detected mode. Cheap to clone (shared connections).
#[derive(Clone)]
pub enum LinuxEnv {
    /// Focus, titles and idle through X11.
    X11(Arc<X11>),
    /// Wayland or no display: windows cannot be observed (reported as not trusted, which the
    /// engine shows as degraded); idle comes from D-Bus when available.
    Degraded(Arc<IdleSource>),
}

impl SamplerEnv for LinuxEnv {
    fn trusted(&self) -> bool {
        matches!(self, Self::X11(_))
    }

    fn window_title(&self, activation: &Activation) -> Option<String> {
        match self {
            Self::X11(x11) => x11.title(u32::try_from(activation.window?).ok()?),
            Self::Degraded(_) => None,
        }
    }

    fn seconds_since_input(&self) -> f64 {
        match self {
            Self::X11(x11) => x11.idle_seconds(),
            Self::Degraded(idle) => idle.seconds_since_input(),
        }
    }

    fn poll_frontmost(&self) -> Option<Activation> {
        match self {
            Self::X11(x11) => x11.activation(),
            Self::Degraded(_) => None,
        }
    }
}

/// Everything started for Linux. Build it once, from any thread.
pub struct LinuxPlatform {
    pub mode: DisplayMode,
    pub env: LinuxEnv,
    pub activations: Receiver<Activation>,
    /// Sleep/wake, shutdown and lock/unlock from logind; also the `PowerEventsProvider`.
    pub power: SignalFanout,
    pub permission: LinuxPermission,
}

impl LinuxPlatform {
    /// Probes the session once and starts the listener threads that apply to it.
    pub fn start() -> Self {
        let wayland = is_wayland_session(
            std::env::var("WAYLAND_DISPLAY").ok().as_deref(),
            std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
        );
        let x11 = X11::connect()
            .map_err(|error| eprintln!("no X11 display: {error}"))
            .ok();
        let probe = match &x11 {
            None => probe_from(false, false, false),
            Some(x11) => probe_from(true, x11.is_xwayland(), x11.active_window().is_some()),
        };
        let mode = decide(wayland, probe);

        let power = SignalFanout::new();
        #[cfg(feature = "logind")]
        if let Err(error) = crate::dbus::spawn_logind_listener(power.clone()) {
            eprintln!("could not start the logind listener: {error}");
        }

        let (tx, activations) = bounded(ACTIVATION_QUEUE);
        let env = match (mode, x11) {
            (DisplayMode::X11, Some(x11)) => {
                if let Err(error) = spawn_listener(tx) {
                    eprintln!("could not start the X11 listener: {error}");
                }
                LinuxEnv::X11(Arc::new(x11))
            }
            _ => {
                eprintln!("window tracking unavailable ({mode:?}); only idle time is observed");
                LinuxEnv::Degraded(Arc::new(IdleSource::connect()))
            }
        };
        Self {
            mode,
            env,
            activations,
            power,
            permission: LinuxPermission { mode },
        }
    }

    /// The application in front at startup, so `Start` has a focus before the first event.
    pub fn frontmost(&self) -> Option<Activation> {
        self.env.poll_frontmost()
    }
}

/// Linux needs no permission on X11. Wayland (or no display) is reported as `Denied` so the
/// existing degraded path shows a banner, with a reason that explains why.
#[derive(Debug, Clone, Copy)]
pub struct LinuxPermission {
    mode: DisplayMode,
}

impl LinuxPermission {
    pub fn new(mode: DisplayMode) -> Self {
        Self { mode }
    }
}

impl PermissionProvider for LinuxPermission {
    fn accessibility(&self) -> PermissionState {
        if self.mode == DisplayMode::X11 {
            PermissionState::Granted
        } else {
            PermissionState::Denied
        }
    }

    /// Nothing to grant: the session type decides.
    fn request(&self) {}

    fn open_settings(&self) {}

    fn degraded_reason(&self) -> DegradedReason {
        degraded_reason(self.mode).unwrap_or(DegradedReason::WaylandSession)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_follows_the_mode() {
        assert_eq!(
            LinuxPermission::new(DisplayMode::X11).accessibility(),
            PermissionState::Granted
        );
        let wayland = LinuxPermission::new(DisplayMode::Wayland);
        assert_eq!(wayland.accessibility(), PermissionState::Denied);
        assert_eq!(wayland.degraded_reason(), DegradedReason::WaylandSession);
        assert_eq!(
            LinuxPermission::new(DisplayMode::NoDisplay).degraded_reason(),
            DegradedReason::NoDisplay
        );
    }

    #[test]
    fn a_degraded_environment_observes_no_window() {
        let env = LinuxEnv::Degraded(Arc::new(IdleSource::connect()));
        assert!(!env.trusted());
        assert_eq!(env.poll_frontmost(), None);
        assert!(env.seconds_since_input() >= 0.0);
    }

    /// Run under Xvfb in CI: `xvfb-run cargo test -p adapters-linux -- --ignored`.
    #[test]
    #[ignore = "needs an X server in $DISPLAY (CI runs it under Xvfb)"]
    fn the_x11_environment_answers_without_panicking() {
        let x11 = X11::connect().expect("an X server in $DISPLAY");
        // A bare Xvfb has no window manager, so no active window is expected.
        let _ = x11.active_window();
        let _ = x11.is_xwayland();
        let env = LinuxEnv::X11(Arc::new(x11));
        assert!(env.trusted());
        assert!(env.seconds_since_input() >= 0.0);
        let _ = env.poll_frontmost();
        let platform = LinuxPlatform::start();
        let _ = platform.frontmost();
    }
}
