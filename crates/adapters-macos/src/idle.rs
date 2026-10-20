//! Idle detection (design sections 6 and 11, task 2.5). The edge detector is shared with the
//! other platforms (`adapters_common::idle`); this module only reads the macOS counter.

pub use adapters_common::idle::{IdleThreshold, IdleTracker};

#[cfg(target_os = "macos")]
pub use mac::MacIdle;

#[cfg(target_os = "macos")]
mod mac {
    use application::ports::IdleProvider;
    use objc2_core_graphics::{CGEventSource, CGEventSourceStateID, CGEventType};

    /// `CGEventSource` idle counter. Needs no permission (phase 2 spike).
    #[derive(Debug, Default, Clone, Copy)]
    pub struct MacIdle;

    impl IdleProvider for MacIdle {
        fn seconds_since_input(&self) -> f64 {
            // `kCGAnyInputEventType` is `~0`; the crate does not expose it as a constant.
            CGEventSource::seconds_since_last_event_type(
                CGEventSourceStateID::CombinedSessionState,
                CGEventType(u32::MAX),
            )
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn the_os_counter_is_readable_without_permission() {
        use application::ports::IdleProvider;
        let seconds = MacIdle.seconds_since_input();
        assert!(seconds >= 0.0, "got {seconds}");
    }
}
