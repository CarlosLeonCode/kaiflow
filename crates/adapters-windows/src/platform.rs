//! What the composition root wires on Windows: the sampler environment, the activation
//! stream, the power/lock fan-out and the permission provider.

use std::sync::Arc;

use adapters_common::activation::Activation;
use adapters_common::fanout::SignalFanout;
use adapters_common::sampler::SamplerEnv;
use application::ports::{IdleProvider, PermissionProvider};
use crossbeam_channel::{Receiver, bounded};
use domain::PermissionState;

use crate::foreground::{DescriptionCache, foreground_activation, id_to_hwnd, window_title};
use crate::idle::WinIdle;
use crate::message_loop;

/// Pending activations kept for the sampler; older ones are irrelevant (it polls anyway).
const ACTIVATION_QUEUE: usize = 64;

/// Sampler environment backed by Win32. Titles need no permission on Windows.
#[derive(Debug, Clone, Default)]
pub struct WinEnv {
    cache: Arc<DescriptionCache>,
}

impl SamplerEnv for WinEnv {
    fn trusted(&self) -> bool {
        true
    }

    fn window_title(&self, activation: &Activation) -> Option<String> {
        window_title(id_to_hwnd(activation.window?))
    }

    fn seconds_since_input(&self) -> f64 {
        WinIdle.seconds_since_input()
    }

    fn poll_frontmost(&self) -> Option<Activation> {
        foreground_activation(&self.cache)
    }
}

/// Everything started for Windows. Build it once, from any thread.
pub struct WindowsPlatform {
    pub env: WinEnv,
    pub activations: Receiver<Activation>,
    /// Lock/unlock, sleep/wake and end-of-session; also the `PowerEventsProvider`.
    pub power: SignalFanout,
}

impl WindowsPlatform {
    /// Starts the event thread. If it cannot be spawned, focus tracking still works through
    /// polling; only the lock and sleep notifications are lost (logged).
    pub fn start() -> Self {
        let env = WinEnv::default();
        let power = SignalFanout::new();
        let (tx, activations) = bounded(ACTIVATION_QUEUE);
        if let Err(error) = message_loop::spawn(tx, power.clone(), env.cache.clone()) {
            eprintln!("could not start the Windows event thread: {error}");
        }
        Self {
            env,
            activations,
            power,
        }
    }

    /// The application in front at startup, so `Start` has a focus before the first event.
    pub fn frontmost(&self) -> Option<Activation> {
        self.env.poll_frontmost()
    }
}

/// Windows needs no permission to read foreground windows and titles.
#[derive(Debug, Default, Clone, Copy)]
pub struct WinPermission;

impl PermissionProvider for WinPermission {
    fn accessibility(&self) -> PermissionState {
        PermissionState::Granted
    }

    fn request(&self) {}

    fn open_settings(&self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_is_always_granted() {
        let permission = WinPermission;
        assert_eq!(permission.accessibility(), PermissionState::Granted);
        permission.request();
        permission.open_settings();
    }

    #[test]
    #[ignore = "needs an interactive desktop session"]
    fn the_environment_answers_without_panicking() {
        let platform = WindowsPlatform::start();
        let _ = platform.frontmost();
        assert!(platform.env.seconds_since_input() >= 0.0);
    }
}
