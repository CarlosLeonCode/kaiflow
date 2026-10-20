//! `NSWorkspace` observer (design section 6, task 2.3): application activation, sleep, wake
//! and power-off, plus the `pid -> (bundle id, name)` map the sampler uses to avoid touching
//! `NSRunningApplication` off the main thread.
//!
//! Threading: observers are installed on the main thread and their blocks run there. A block
//! only extracts plain values and sends them over channels; it never blocks or does I/O.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use application::ports::SystemSignal;

/// Entries kept at most; terminated apps are removed on `didTerminate`, this is a safety net.
const MAX_IDENTITIES: usize = 512;
/// Pending activations kept for the sampler; older ones are irrelevant (it re-reads focus).
const ACTIVATION_QUEUE: usize = 64;

/// What the engine needs to know about an application (design section 3, `FocusSnapshot`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppIdentity {
    pub bundle_id: String,
    pub name: String,
}

/// An application became frontmost.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Activation {
    pub pid: i32,
    pub identity: AppIdentity,
}

/// Shared `pid -> identity` cache fed by the notifications and read by the sampler thread.
#[derive(Debug, Clone, Default)]
pub struct IdentityMap(Arc<Mutex<HashMap<i32, AppIdentity>>>);

impl IdentityMap {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&self, pid: i32, identity: AppIdentity) {
        let mut map = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if map.len() >= MAX_IDENTITIES && !map.contains_key(&pid) {
            map.clear();
        }
        map.insert(pid, identity);
    }

    pub fn get(&self, pid: i32) -> Option<AppIdentity> {
        let map = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        map.get(&pid).cloned()
    }

    pub fn forget(&self, pid: i32) {
        let mut map = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        map.remove(&pid);
    }

    pub fn len(&self) -> usize {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// The workspace notifications that map to engine signals.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PowerNotification {
    WillSleep,
    DidWake,
    WillPowerOff,
}

pub fn power_signal(notification: PowerNotification) -> SystemSignal {
    match notification {
        PowerNotification::WillSleep => SystemSignal::WillSleep,
        PowerNotification::DidWake => SystemSignal::DidWake,
        PowerNotification::WillPowerOff => SystemSignal::PowerOff,
    }
}

/// Applications without a bundle id (helper daemons, bare executables) are not tracked: the
/// domain requires `app_id` for every tracked segment (design section 3).
pub fn identity_from_parts(bundle_id: Option<String>, name: Option<String>) -> Option<AppIdentity> {
    let bundle_id = bundle_id.filter(|id| !id.is_empty())?;
    let name = name
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| bundle_id.clone());
    Some(AppIdentity { bundle_id, name })
}

#[cfg(target_os = "macos")]
pub use mac::WorkspaceObserver;

#[cfg(target_os = "macos")]
mod mac {
    use std::cell::RefCell;
    use std::ptr::NonNull;

    use application::ports::{PowerEventsProvider, SystemSignal};
    use block2::RcBlock;
    use crossbeam_channel::{Receiver, Sender, bounded};
    use objc2::MainThreadMarker;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, ProtocolObject};
    use objc2_app_kit::{
        NSRunningApplication, NSWorkspace, NSWorkspaceApplicationKey,
        NSWorkspaceDidActivateApplicationNotification,
        NSWorkspaceDidTerminateApplicationNotification, NSWorkspaceDidWakeNotification,
        NSWorkspaceWillPowerOffNotification, NSWorkspaceWillSleepNotification,
    };
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol};

    use super::{
        ACTIVATION_QUEUE, Activation, AppIdentity, IdentityMap, PowerNotification,
        identity_from_parts, power_signal,
    };

    type Token = Retained<ProtocolObject<dyn NSObjectProtocol>>;

    /// Reads `(pid, identity)` from a `NSRunningApplication`; `None` if it is not trackable.
    fn read_app(app: &NSRunningApplication) -> Option<(i32, AppIdentity)> {
        let pid = app.processIdentifier();
        let identity = identity_from_parts(
            app.bundleIdentifier().map(|s| s.to_string()),
            app.localizedName().map(|s| s.to_string()),
        )?;
        Some((pid, identity))
    }

    /// Extracts the `NSRunningApplication` carried in `userInfo[NSWorkspaceApplicationKey]`.
    fn app_from_notification(note: &NSNotification) -> Option<Retained<NSRunningApplication>> {
        let info = note.userInfo()?;
        // SAFETY: the key is the AppKit constant for these notifications.
        let object: Retained<AnyObject> =
            info.objectForKey(unsafe { NSWorkspaceApplicationKey })?;
        object.downcast::<NSRunningApplication>().ok()
    }

    /// Observes the shared workspace notification center.
    ///
    /// Power notifications go to the engine channel given to `subscribe`. Activations are not
    /// sent to the engine directly: the sampler (task 2.4) turns them into `Focus` signals
    /// after reading the window title, so it consumes [`WorkspaceObserver::activations`].
    pub struct WorkspaceObserver {
        identities: IdentityMap,
        activation_tx: Sender<Activation>,
        activation_rx: Receiver<Activation>,
        // Tokens must stay alive for as long as the observers should run. Main thread only.
        tokens: RefCell<Vec<Token>>,
    }

    impl Default for WorkspaceObserver {
        fn default() -> Self {
            Self::new()
        }
    }

    impl WorkspaceObserver {
        pub fn new() -> Self {
            let (activation_tx, activation_rx) = bounded(ACTIVATION_QUEUE);
            Self {
                identities: IdentityMap::new(),
                activation_tx,
                activation_rx,
                tokens: RefCell::new(Vec::new()),
            }
        }

        /// Cache shared with the sampler thread.
        pub fn identities(&self) -> IdentityMap {
            self.identities.clone()
        }

        /// Application activations in order; use `try_iter`/`recv_timeout` from the sampler.
        pub fn activations(&self) -> Receiver<Activation> {
            self.activation_rx.clone()
        }

        /// Frontmost application right now (main thread only).
        pub fn frontmost(&self, _mtm: MainThreadMarker) -> Option<Activation> {
            let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
            let (pid, identity) = read_app(&app)?;
            self.identities.record(pid, identity.clone());
            Some(Activation { pid, identity })
        }

        /// Installs the observers. Must run on the main thread because the blocks are
        /// delivered there (`queue: nil` runs them on the posting thread, which AppKit
        /// guarantees is the main one for workspace notifications).
        pub fn install(&self, _mtm: MainThreadMarker, power_tx: Sender<SystemSignal>) {
            let center = NSWorkspace::sharedWorkspace().notificationCenter();
            let mut tokens = self.tokens.borrow_mut();

            // SAFETY (all `observe` calls): the names are AppKit constants and the blocks
            // only touch `Send` channel handles and the mutex-guarded map.
            let identities = self.identities.clone();
            let activations = self.activation_tx.clone();
            tokens.push(observe(
                &center,
                unsafe { NSWorkspaceDidActivateApplicationNotification },
                move |note| {
                    let Some(app) = app_from_notification(note) else {
                        return;
                    };
                    let Some((pid, identity)) = read_app(&app) else {
                        return;
                    };
                    identities.record(pid, identity.clone());
                    // Full queue: the sampler is behind and re-reads the focus on its tick.
                    let _ = activations.try_send(Activation { pid, identity });
                },
            ));

            let identities = self.identities.clone();
            tokens.push(observe(
                &center,
                unsafe { NSWorkspaceDidTerminateApplicationNotification },
                move |note| {
                    if let Some(app) = app_from_notification(note) {
                        identities.forget(app.processIdentifier());
                    }
                },
            ));

            for (name, kind) in [
                (
                    unsafe { NSWorkspaceWillSleepNotification },
                    PowerNotification::WillSleep,
                ),
                (
                    unsafe { NSWorkspaceDidWakeNotification },
                    PowerNotification::DidWake,
                ),
                (
                    unsafe { NSWorkspaceWillPowerOffNotification },
                    PowerNotification::WillPowerOff,
                ),
            ] {
                let tx = power_tx.clone();
                tokens.push(observe(&center, name, move |_| {
                    let _ = tx.send(power_signal(kind));
                }));
            }
        }
    }

    fn observe(
        center: &NSNotificationCenter,
        name: &objc2_foundation::NSNotificationName,
        handler: impl Fn(&NSNotification) + 'static,
    ) -> Token {
        let block = RcBlock::new(move |note: NonNull<NSNotification>| {
            // SAFETY: the center passes a valid notification for the duration of the call.
            handler(unsafe { note.as_ref() });
        });
        // SAFETY: `queue: None` delivers on the posting thread; the block is copied by the center.
        unsafe { center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block) }
    }

    impl Drop for WorkspaceObserver {
        fn drop(&mut self) {
            if let Some(_mtm) = MainThreadMarker::new() {
                let center = NSWorkspace::sharedWorkspace().notificationCenter();
                for token in self.tokens.borrow_mut().drain(..) {
                    // SAFETY: each token was returned by `addObserverForName...` on this center.
                    unsafe { center.removeObserver(token.as_ref()) };
                }
            }
        }
    }

    impl PowerEventsProvider for WorkspaceObserver {
        /// Composition calls this from Tauri's `setup`, which runs on the main thread. From any
        /// other thread nothing is installed (the AppKit objects are main-thread only).
        fn subscribe(&self, tx: Sender<SystemSignal>) {
            match MainThreadMarker::new() {
                Some(mtm) => self.install(mtm, tx),
                None => eprintln!("WorkspaceObserver::subscribe must run on the main thread"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(bundle: &str, name: &str) -> AppIdentity {
        AppIdentity {
            bundle_id: bundle.into(),
            name: name.into(),
        }
    }

    #[test]
    fn power_notifications_map_to_engine_signals() {
        assert_eq!(
            power_signal(PowerNotification::WillSleep),
            SystemSignal::WillSleep
        );
        assert_eq!(
            power_signal(PowerNotification::DidWake),
            SystemSignal::DidWake
        );
        assert_eq!(
            power_signal(PowerNotification::WillPowerOff),
            SystemSignal::PowerOff
        );
    }

    #[test]
    fn identity_requires_a_bundle_id_and_falls_back_to_it_for_the_name() {
        assert_eq!(identity_from_parts(None, Some("X".into())), None);
        assert_eq!(
            identity_from_parts(Some(String::new()), Some("X".into())),
            None
        );
        assert_eq!(
            identity_from_parts(Some("com.a.b".into()), Some("App".into())),
            Some(id("com.a.b", "App"))
        );
        assert_eq!(
            identity_from_parts(Some("com.a.b".into()), None),
            Some(id("com.a.b", "com.a.b"))
        );
    }

    #[test]
    fn map_records_replaces_and_forgets() {
        let map = IdentityMap::new();
        assert!(map.is_empty());
        map.record(10, id("a", "A"));
        map.record(10, id("b", "B"));
        assert_eq!(map.get(10), Some(id("b", "B")));
        map.forget(10);
        assert_eq!(map.get(10), None);
    }

    #[test]
    fn map_is_shared_between_clones() {
        let map = IdentityMap::new();
        let other = map.clone();
        map.record(1, id("a", "A"));
        assert_eq!(other.get(1), Some(id("a", "A")));
    }

    #[test]
    fn map_stays_bounded() {
        let map = IdentityMap::new();
        for pid in 0..(MAX_IDENTITIES as i32 + 10) {
            map.record(pid, id("a", "A"));
        }
        assert!(map.len() <= MAX_IDENTITIES);
        assert!(map.get(MAX_IDENTITIES as i32 + 9).is_some());
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "needs a GUI login session and the main thread; run via the spike probe"]
    fn observer_delivers_the_frontmost_app() {
        // The test harness runs tests off the main thread, so this cannot be exercised from
        // `cargo test`; see docs/spikes/phase-2-macos.md for the probe that covers it.
    }
}
