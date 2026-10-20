//! The 2 s sampler (design section 6, task 2.4). The decision logic is platform neutral and
//! lives in `adapters_common::sampler`; this module supplies the macOS environment:
//! `AXIsProcessTrusted` on every tick (live revocation, R5.2), the AX window title of the
//! frontmost app and the `CGEventSource` idle counter. It never uses Screen Recording.

pub use adapters_common::sampler::*;

/// Real environment: AX trust, AX title and the `CGEventSource` idle counter.
#[cfg(target_os = "macos")]
#[derive(Debug, Default, Clone, Copy)]
pub struct MacEnv;

#[cfg(target_os = "macos")]
impl SamplerEnv for MacEnv {
    fn trusted(&self) -> bool {
        crate::permission::MacPermissionProvider::is_trusted()
    }

    fn window_title(&self, activation: &crate::workspace_observer::Activation) -> Option<String> {
        crate::ax::focused_window_title(activation.pid)
    }

    fn seconds_since_input(&self) -> f64 {
        use application::ports::IdleProvider;
        crate::idle::MacIdle.seconds_since_input()
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use crate::workspace_observer::{Activation, AppIdentity};

    #[test]
    #[ignore = "needs Accessibility granted to the test runner and a GUI session"]
    fn the_real_environment_answers_without_panicking() {
        let env = MacEnv;
        let _ = env.trusted();
        let _ = env.seconds_since_input();
        let me = Activation::of_process(
            std::process::id() as i32,
            AppIdentity {
                bundle_id: "test".into(),
                name: "test".into(),
            },
        );
        let _ = env.window_title(&me);
    }
}
