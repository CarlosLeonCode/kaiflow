//! Screen lock and unlock (design sections 6 and 11, task 2.5). macOS publishes
//! `com.apple.screenIsLocked` / `com.apple.screenIsUnlocked` on the distributed notification
//! center; there is no public constant. Real delivery is part of the manual checklist (2.9).
//!
//! The notifications are observed with `NSNotificationSuspensionBehaviorDeliverImmediately`:
//! AppKit suspends distributed notification delivery while an app is not active, and
//! Kaiflow is a menu-bar agent that is almost never active. With the default (coalesce)
//! behavior a lock could reach the engine only when the user next opened the popover.
//!
//! Second line of defense: while the screen is locked the frontmost application is
//! `loginwindow` (or the screen saver). The sampler treats those as "away"
//! ([`is_away_app`]): they never get a tracked segment and count as a lock.

use application::ports::SystemSignal;

pub const SCREEN_LOCKED: &str = "com.apple.screenIsLocked";
pub const SCREEN_UNLOCKED: &str = "com.apple.screenIsUnlocked";

/// Bundle ids that are frontmost only while the user is away: the lock screen / login
/// window and the screen saver.
pub const AWAY_APPS: [&str; 2] = ["com.apple.loginwindow", "com.apple.ScreenSaver.Engine"];

/// Whether `bundle_id` being frontmost means the screen is locked (or the saver is running).
pub fn is_away_app(bundle_id: &str) -> bool {
    AWAY_APPS.contains(&bundle_id)
}

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
    use objc2::rc::Retained;
    use objc2::runtime::NSObject;
    use objc2::{AnyThread, DefinedClass, MainThreadMarker, define_class, msg_send, sel};
    use objc2_foundation::{
        NSDistributedNotificationCenter, NSNotification, NSNotificationSuspensionBehavior, NSString,
    };

    use super::{SCREEN_LOCKED, SCREEN_UNLOCKED, lock_signal};

    pub struct TargetIvars {
        tx: Sender<SystemSignal>,
    }

    define_class!(
        // SAFETY: NSObject has no subclassing requirements and `LockTarget` has no `Drop`.
        #[unsafe(super(NSObject))]
        #[name = "KaiflowLockTarget"]
        #[ivars = TargetIvars]
        struct LockTarget;

        impl LockTarget {
            /// Runs on the main thread (the run loop the observer was registered from). Only
            /// maps the name and sends a value; never blocks.
            #[unsafe(method(screenLockChanged:))]
            fn screen_lock_changed(&self, note: &NSNotification) {
                let name = note.name().to_string();
                if let Some(signal) = lock_signal(&name) {
                    let _ = self.ivars().tx.send(signal);
                }
            }
        }
    );

    impl LockTarget {
        fn new(tx: Sender<SystemSignal>) -> Retained<Self> {
            let this = Self::alloc().set_ivars(TargetIvars { tx });
            // SAFETY: plain `-[NSObject init]`.
            unsafe { msg_send![super(this), init] }
        }
    }

    /// Observes lock/unlock on the main thread. Like `WorkspaceObserver` it must be kept
    /// alive by the caller for as long as events should flow.
    #[derive(Default)]
    pub struct LockObserver {
        targets: RefCell<Vec<Retained<LockTarget>>>,
    }

    impl LockObserver {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn install(&self, _mtm: MainThreadMarker, tx: Sender<SystemSignal>) {
            let center = NSDistributedNotificationCenter::defaultCenter();
            let target = LockTarget::new(tx);
            for name in [SCREEN_LOCKED, SCREEN_UNLOCKED] {
                let ns_name = NSString::from_str(name);
                // SAFETY: `target` implements `screenLockChanged:` taking an NSNotification
                // and is kept alive (and removed in `drop`) by this observer.
                unsafe {
                    center.addObserver_selector_name_object_suspensionBehavior(
                        &target,
                        sel!(screenLockChanged:),
                        Some(&ns_name),
                        None,
                        NSNotificationSuspensionBehavior::DeliverImmediately,
                    );
                }
            }
            self.targets.borrow_mut().push(target);
        }
    }

    impl Drop for LockObserver {
        fn drop(&mut self) {
            let center = NSDistributedNotificationCenter::defaultCenter();
            for target in self.targets.borrow_mut().drain(..) {
                // SAFETY: `target` was registered on this center in `install`.
                unsafe { center.removeObserver(&target) };
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

    #[test]
    fn only_the_lock_screen_and_screen_saver_are_away() {
        assert!(is_away_app("com.apple.loginwindow"));
        assert!(is_away_app("com.apple.ScreenSaver.Engine"));
        assert!(!is_away_app("com.apple.finder"));
        assert!(!is_away_app("com.apple.LOGINWINDOW"));
        assert!(!is_away_app(""));
    }
}
