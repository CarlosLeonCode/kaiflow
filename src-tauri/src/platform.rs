//! Chooses the OS adapters. On macOS the real observers, sampler and permission provider
//! from `adapters-macos` are wired; other platforms keep the no-op placeholders (the ports
//! are ready for Windows/Linux but v1 has no implementation for them).

use tauri::{AppHandle, Wry};

use crate::composition::Providers;
use crate::notifications::{SystemNotifier, TauriToaster};

/// Providers for the running platform. Must be called on the main thread: the AppKit
/// observers are created and kept alive here.
pub fn providers(app: &AppHandle<Wry>) -> Providers {
    let notifier = Box::new(SystemNotifier::new(TauriToaster::new(app.clone())));
    #[cfg(target_os = "macos")]
    {
        if let Some(providers) = mac::providers(notifier) {
            return providers;
        }
        eprintln!("not on the main thread: native observers disabled");
    }
    Providers {
        notifier: Box::new(SystemNotifier::new(TauriToaster::new(app.clone()))),
        ..Providers::placeholders()
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::sync::Arc;

    use adapters_macos::idle::IdleThreshold;
    use adapters_macos::lock::LockObserver;
    use adapters_macos::permission::MacPermissionProvider;
    use adapters_macos::sampler::{MacEnv, Sampler, SamplerWindow, SharedFrontmost};
    use adapters_macos::workspace_observer::WorkspaceObserver;
    use application::ports::{Notifier, PowerEventsProvider, SystemSignal};
    use crossbeam_channel::Sender;
    use objc2::MainThreadMarker;

    use crate::composition::{Providers, SystemClock};

    /// Sleep/wake/power-off from the workspace and lock/unlock from the distributed center.
    struct MacPower {
        workspace: &'static WorkspaceObserver,
        lock: &'static LockObserver,
    }

    impl PowerEventsProvider for MacPower {
        fn subscribe(&self, tx: Sender<SystemSignal>) {
            self.workspace.subscribe(tx.clone());
            self.lock.subscribe(tx);
        }
    }

    /// `None` when not on the main thread (observers cannot be installed from elsewhere).
    pub fn providers(notifier: Box<dyn Notifier>) -> Option<Providers> {
        let mtm = MainThreadMarker::new()?;

        // The observers must outlive `setup`: dropping them removes the notification
        // blocks. They hold main-thread-only handles, so they cannot live in the managed
        // state; leaking two small objects once per process is the intended lifetime.
        let workspace: &'static WorkspaceObserver = Box::leak(Box::new(WorkspaceObserver::new()));
        let lock: &'static LockObserver = Box::leak(Box::new(LockObserver::new()));

        let frontmost = SharedFrontmost::new(workspace.frontmost(mtm));
        let threshold = IdleThreshold::default();
        let sampler = Sampler::new(
            MacEnv,
            frontmost.clone(),
            threshold.clone(),
            workspace.activations(),
            Box::new(SystemClock),
        );

        Some(Providers {
            window: Box::new(SamplerWindow::new(frontmost, MacEnv)),
            power: Box::new(MacPower { workspace, lock }),
            permission: Arc::new(MacPermissionProvider::new()),
            notifier,
            idle_threshold: threshold,
            sampler: Some(Box::new(move |engine, stop| sampler.spawn(engine, stop))),
        })
    }
}
