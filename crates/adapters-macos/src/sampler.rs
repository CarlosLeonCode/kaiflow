//! The 2 s sampler (design section 6, task 2.4). The decision logic is platform neutral and
//! lives in `adapters_common::sampler`; this module supplies the macOS environment:
//! `AXIsProcessTrusted` on every tick (live revocation, R5.2), the AX window title of the
//! frontmost app, the `CGEventSource` idle counter and the lock-screen apps that mean "away".
//! It never uses Screen Recording.

pub use adapters_common::sampler::*;

/// Real environment: AX trust, AX title and the `CGEventSource` idle counter. Clones share
/// the per-process remedy state and the diagnostics log.
#[cfg(target_os = "macos")]
#[derive(Debug, Default, Clone)]
pub struct MacEnv {
    inner: std::sync::Arc<mac::Inner>,
}

#[cfg(target_os = "macos")]
impl MacEnv {
    /// Records trust changes and per-app title read results in `diagnostics`.
    pub fn new(diagnostics: adapters_common::diagnostics::Diagnostics) -> Self {
        Self {
            inner: std::sync::Arc::new(mac::Inner::new(Some(diagnostics))),
        }
    }
}

#[cfg(target_os = "macos")]
impl SamplerEnv for MacEnv {
    fn trusted(&self) -> bool {
        let trusted = crate::permission::MacPermissionProvider::is_trusted();
        if let Some(diagnostics) = &self.inner.diagnostics {
            diagnostics.record_trust(trusted, mac::now());
        }
        trusted
    }

    fn window_title(&self, activation: &crate::workspace_observer::Activation) -> Option<String> {
        self.inner.window_title(activation)
    }

    fn seconds_since_input(&self) -> f64 {
        use application::ports::IdleProvider;
        crate::idle::MacIdle.seconds_since_input()
    }

    fn is_away(&self, activation: &crate::workspace_observer::Activation) -> bool {
        crate::lock::is_away_app(&activation.identity.bundle_id)
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::collections::HashMap;
    use std::sync::{Mutex, PoisonError};
    use std::time::{SystemTime, UNIX_EPOCH};

    use adapters_common::diagnostics::Diagnostics;
    use domain::UtcMs;

    use crate::ax::{self, RemedyState, next_remedy};
    use crate::workspace_observer::Activation;

    /// Processes whose remedy state is remembered; cleared when full (pids are reused).
    const MAX_PIDS: usize = 256;

    #[derive(Debug, Default)]
    pub(super) struct Inner {
        pub(super) diagnostics: Option<Diagnostics>,
        remedies: Mutex<HashMap<i32, RemedyState>>,
    }

    pub(super) fn now() -> UtcMs {
        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX));
        UtcMs(ms)
    }

    impl Inner {
        pub(super) fn new(diagnostics: Option<Diagnostics>) -> Self {
            Self {
                diagnostics,
                remedies: Mutex::default(),
            }
        }

        pub(super) fn window_title(&self, activation: &Activation) -> Option<String> {
            let app_id = activation.identity.bundle_id.as_str();
            let (title, probe) = ax::read_focused_title(activation.pid);
            let at = now();
            if let Some(diagnostics) = &self.diagnostics {
                diagnostics.record_title(app_id, probe, at);
            }
            let remedy = {
                let mut remedies = self.remedies.lock().unwrap_or_else(PoisonError::into_inner);
                if remedies.len() >= MAX_PIDS && !remedies.contains_key(&activation.pid) {
                    remedies.clear();
                }
                let state = remedies.entry(activation.pid).or_default();
                let remedy = next_remedy(app_id, &probe, state);
                // Recorded before the call so a hung app is never asked twice.
                if let Some(remedy) = remedy {
                    state.applied(remedy, ax::codes::CANNOT_COMPLETE);
                }
                remedy
            };
            if let Some(remedy) = remedy {
                // Takes effect for the next read (next tick): the tree is built lazily.
                let result = ax::set_app_flag(activation.pid, remedy.attribute(), true);
                if let Some(state) = self
                    .remedies
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .get_mut(&activation.pid)
                {
                    state.applied(remedy, result);
                }
                if let Some(diagnostics) = &self.diagnostics {
                    diagnostics.record_note(app_id, remedy.note(result), at);
                }
            }
            title
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use crate::workspace_observer::{Activation, AppIdentity};

    fn me(bundle_id: &str) -> Activation {
        Activation::of_process(
            std::process::id() as i32,
            AppIdentity {
                bundle_id: bundle_id.into(),
                name: "test".into(),
            },
        )
    }

    #[test]
    fn the_lock_screen_apps_are_away() {
        let env = MacEnv::default();
        assert!(env.is_away(&me("com.apple.loginwindow")));
        assert!(env.is_away(&me("com.apple.ScreenSaver.Engine")));
        assert!(!env.is_away(&me("com.apple.finder")));
    }

    #[test]
    fn a_title_read_is_recorded_in_the_diagnostics_without_the_title() {
        let dir = tempfile::tempdir().unwrap();
        let diagnostics = adapters_common::diagnostics::Diagnostics::in_dir(dir.path());
        let env = MacEnv::new(diagnostics.clone());
        // A test binary has no windows (and usually no AX trust): some failure is recorded.
        let _ = env.window_title(&me("com.example.test"));
        let snapshot = diagnostics.snapshot();
        assert_eq!(snapshot.title_reads.len(), 1);
        assert_eq!(snapshot.title_reads[0].app_id, "com.example.test");
    }

    #[test]
    #[ignore = "needs Accessibility granted to the test runner and a GUI session"]
    fn the_real_environment_answers_without_panicking() {
        let env = MacEnv::default();
        let _ = env.trusted();
        let _ = env.seconds_since_input();
        let _ = env.window_title(&me("test"));
    }
}
