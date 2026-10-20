//! Screen lock and unlock (design sections 6 and 11, task 2.5). macOS publishes
//! `com.apple.screenIsLocked` / `com.apple.screenIsUnlocked` on the distributed notification
//! center; there is no public constant. Real delivery is part of the manual checklist (2.9).

use application::ports::SystemSignal;

pub const SCREEN_LOCKED: &str = "com.apple.screenIsLocked";
pub const SCREEN_UNLOCKED: &str = "com.apple.screenIsUnlocked";

/// Maps a distributed notification name to the engine signal; unknown names are ignored.
pub fn lock_signal(name: &str) -> Option<SystemSignal> {
    match name {
        SCREEN_LOCKED => Some(SystemSignal::ScreenLocked),
        SCREEN_UNLOCKED => Some(SystemSignal::ScreenUnlocked),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
pub use mac::LockObserver;

#[cfg(target_os = "macos")]
mod mac {
    use std::cell::RefCell;

    use application::ports::{PowerEventsProvider, SystemSignal};
    use crossbeam_channel::Sender;
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSDistributedNotificationCenter, NSString};

    use super::{SCREEN_LOCKED, SCREEN_UNLOCKED, lock_signal};
    use crate::workspace_observer::{Token, observe};

    /// Observes lock/unlock on the main thread. Like `WorkspaceObserver` it must be kept
    /// alive by the caller for as long as events should flow.
    #[derive(Default)]
    pub struct LockObserver {
        tokens: RefCell<Vec<Token>>,
    }

    impl LockObserver {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn install(&self, _mtm: MainThreadMarker, tx: Sender<SystemSignal>) {
            let center = NSDistributedNotificationCenter::defaultCenter();
            let mut tokens = self.tokens.borrow_mut();
            for name in [SCREEN_LOCKED, SCREEN_UNLOCKED] {
                let tx = tx.clone();
                let ns_name = NSString::from_str(name);
                tokens.push(observe(&center, &ns_name, move |_| {
                    if let Some(signal) = lock_signal(name) {
                        let _ = tx.send(signal);
                    }
                }));
            }
        }
    }

    impl Drop for LockObserver {
        fn drop(&mut self) {
            if MainThreadMarker::new().is_some() {
                let center = NSDistributedNotificationCenter::defaultCenter();
                for token in self.tokens.borrow_mut().drain(..) {
                    // SAFETY: each token came from `addObserverForName...` on this center.
                    unsafe { center.removeObserver(token.as_ref()) };
                }
            }
        }
    }

    impl PowerEventsProvider for LockObserver {
        fn subscribe(&self, tx: Sender<SystemSignal>) {
            match MainThreadMarker::new() {
                Some(mtm) => self.install(mtm, tx),
                None => eprintln!("LockObserver::subscribe must run on the main thread"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_names_map_to_signals() {
        assert_eq!(
            lock_signal("com.apple.screenIsLocked"),
            Some(SystemSignal::ScreenLocked)
        );
        assert_eq!(
            lock_signal("com.apple.screenIsUnlocked"),
            Some(SystemSignal::ScreenUnlocked)
        );
        assert_eq!(lock_signal("com.apple.screensaver.didstart"), None);
    }
}
