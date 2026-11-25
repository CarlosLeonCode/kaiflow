//! Chooses the OS adapters: `adapters-macos` (AppKit observers, Accessibility),
//! `adapters-windows` (Win32 foreground window, WinEvent hook, session/power messages) or
//! `adapters-linux` (X11 + logind, degraded on Wayland). All three drive the shared sampler
//! from `adapters-common`. The no-op placeholders remain only as a last resort (unsupported
//! OS, or macOS when not called on the main thread).

use adapters_common::diagnostics::Diagnostics;
use application::language::UiLanguage;
use application::ports::Notifier;
use tauri::{AppHandle, Wry};

use crate::composition::Providers;
use crate::notifications::{SystemNotifier, TauriToaster};

/// Providers for the running platform. Must be called on the main thread: the AppKit
/// observers are created and kept alive here (the other platforms start their own threads).
/// `diagnostics` receives the privacy-safe adapter log: lock/sleep/idle signals and adapters
/// that could not start on every OS, plus AX trust and title read status on macOS. The
/// notifier words its messages in `language`.
pub fn providers(
    app: &AppHandle<Wry>,
    diagnostics: &Diagnostics,
    language: &UiLanguage,
) -> Providers {
    let notifier = |language: &UiLanguage| -> Box<dyn Notifier> {
        Box::new(SystemNotifier::new(
            TauriToaster::new(app.clone()),
            language.clone(),
        ))
    };
    native(notifier(language), diagnostics).unwrap_or_else(|| {
        diagnostics.record_failure(
            "platform",
            &"no native adapters (unsupported OS or not on the main thread): tracking is idle",
        );
        Providers {
            notifier: notifier(language),
            ..Providers::placeholders()
        }
    })
}

/// `None` when not on the main thread (observers cannot be installed from elsewhere).
#[cfg(target_os = "macos")]
fn native(notifier: Box<dyn Notifier>, diagnostics: &Diagnostics) -> Option<Providers> {
    mac::providers(notifier, diagnostics)
}

#[cfg(windows)]
fn native(notifier: Box<dyn Notifier>, diagnostics: &Diagnostics) -> Option<Providers> {
    Some(win::providers(notifier, diagnostics))
}

#[cfg(target_os = "linux")]
fn native(notifier: Box<dyn Notifier>, diagnostics: &Diagnostics) -> Option<Providers> {
    Some(linux::providers(notifier, diagnostics))
}

/// Power and lock signals of Windows and Linux, logged like the macOS ones on their way to
/// the engine (on a helper thread, see [`Diagnostics::forwarding`]).
#[cfg(any(windows, target_os = "linux"))]
struct LoggedPower<P> {
    inner: P,
    diagnostics: Diagnostics,
}

#[cfg(any(windows, target_os = "linux"))]
impl<P: application::ports::PowerEventsProvider> application::ports::PowerEventsProvider
    for LoggedPower<P>
{
    fn subscribe(&self, tx: crossbeam_channel::Sender<application::ports::SystemSignal>) {
        use application::ports::Clock;
        let tx = self
            .diagnostics
            .forwarding("os", tx, || crate::composition::SystemClock.now());
        self.inner.subscribe(tx);
    }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn native(_notifier: Box<dyn Notifier>, _diagnostics: &Diagnostics) -> Option<Providers> {
    None
}

#[cfg(target_os = "macos")]
mod mac {
    use std::sync::Arc;

    use adapters_common::diagnostics::Diagnostics;
    use adapters_macos::idle::IdleThreshold;
    use adapters_macos::lock::LockObserver;
    use adapters_macos::permission::MacPermissionProvider;
    use adapters_macos::sampler::{MacEnv, Sampler, SamplerWindow, SharedFrontmost};
    use adapters_macos::workspace_observer::WorkspaceObserver;
    use application::ports::{Clock, Notifier, PowerEventsProvider, SystemSignal};
    use crossbeam_channel::Sender;
    use objc2::MainThreadMarker;

    use crate::composition::{Providers, SystemClock};

    /// Sleep/wake/power-off from the workspace and lock/unlock from the distributed center.
    struct MacPower {
        workspace: &'static WorkspaceObserver,
        lock: &'static LockObserver,
        diagnostics: Diagnostics,
    }

    impl PowerEventsProvider for MacPower {
        fn subscribe(&self, tx: Sender<SystemSignal>) {
            // Logged on a helper thread, so the main-thread observers never do file I/O.
            let tx = self.diagnostics.forwarding("os", tx, || SystemClock.now());
            self.workspace.subscribe(tx.clone());
            self.lock.subscribe(tx);
        }
    }

    /// `None` when not on the main thread (observers cannot be installed from elsewhere).
    pub fn providers(notifier: Box<dyn Notifier>, diagnostics: &Diagnostics) -> Option<Providers> {
        let mtm = MainThreadMarker::new()?;

        // The observers must outlive `setup`: dropping them removes the notification
        // blocks. They hold main-thread-only handles, so they cannot live in the managed
        // state; leaking two small objects once per process is the intended lifetime.
        let workspace: &'static WorkspaceObserver = Box::leak(Box::new(WorkspaceObserver::new()));
        let lock: &'static LockObserver = Box::leak(Box::new(LockObserver::new()));

        let frontmost = SharedFrontmost::new(workspace.frontmost(mtm));
        let threshold = IdleThreshold::default();
        let env = MacEnv::new(diagnostics.clone());
        let sampler = Sampler::new(
            env.clone(),
            frontmost.clone(),
            threshold.clone(),
            workspace.activations(),
            Box::new(SystemClock),
        )
        .with_diagnostics(diagnostics.clone());

        Some(Providers {
            window: Box::new(SamplerWindow::new(frontmost, env)),
            power: Box::new(MacPower {
                workspace,
                lock,
                diagnostics: diagnostics.clone(),
            }),
            permission: Arc::new(MacPermissionProvider::new()),
            notifier,
            idle_threshold: threshold,
            sampler: Some(Box::new(move |engine, stop| sampler.spawn(engine, stop))),
            display_session: None,
        })
    }
}

#[cfg(windows)]
mod win {
    use std::sync::Arc;

    use adapters_common::diagnostics::Diagnostics;
    use adapters_common::idle::IdleThreshold;
    use adapters_common::sampler::{Sampler, SamplerWindow, SharedFrontmost};
    use adapters_windows::{WinPermission, WindowsPlatform};
    use application::ports::Notifier;

    use super::LoggedPower;
    use crate::composition::{Providers, SystemClock};

    pub fn providers(notifier: Box<dyn Notifier>, diagnostics: &Diagnostics) -> Providers {
        let platform = WindowsPlatform::start(diagnostics);
        let frontmost = SharedFrontmost::new(platform.frontmost());
        let threshold = IdleThreshold::default();
        let sampler = Sampler::new(
            platform.env.clone(),
            frontmost.clone(),
            threshold.clone(),
            platform.activations,
            Box::new(SystemClock),
        )
        .with_diagnostics(diagnostics.clone());
        Providers {
            window: Box::new(SamplerWindow::new(frontmost, platform.env)),
            power: Box::new(LoggedPower {
                inner: platform.power,
                diagnostics: diagnostics.clone(),
            }),
            permission: Arc::new(WinPermission),
            notifier,
            idle_threshold: threshold,
            sampler: Some(Box::new(move |engine, stop| sampler.spawn(engine, stop))),
            display_session: None,
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::sync::Arc;

    use adapters_common::diagnostics::Diagnostics;
    use adapters_common::idle::IdleThreshold;
    use adapters_common::sampler::{Sampler, SamplerWindow, SharedFrontmost};
    use adapters_linux::LinuxPlatform;
    use adapters_linux::session::DisplayMode;
    use application::ports::Notifier;

    use super::LoggedPower;
    use crate::composition::{Providers, SystemClock};
    use crate::ipc::dto::DisplaySessionDto;
    use crate::notifications::WithoutRevocationNotice;

    pub fn providers(notifier: Box<dyn Notifier>, diagnostics: &Diagnostics) -> Providers {
        let platform = LinuxPlatform::start(diagnostics);
        // The effective mode, not just the environment: Wayland with a usable X11 view of
        // the active window tracks like X11, so the UI must not call it unavailable.
        let display_session = match platform.mode {
            DisplayMode::X11 => Some(DisplaySessionDto::X11),
            DisplayMode::Wayland => Some(DisplaySessionDto::Wayland),
            DisplayMode::NoDisplay => None,
        };
        // A degraded Linux session is never a revoked permission (the banner explains it).
        let notifier = Box::new(WithoutRevocationNotice(notifier));
        let frontmost = SharedFrontmost::new(platform.frontmost());
        let threshold = IdleThreshold::default();
        let sampler = Sampler::new(
            platform.env.clone(),
            frontmost.clone(),
            threshold.clone(),
            platform.activations,
            Box::new(SystemClock),
        )
        .with_diagnostics(diagnostics.clone());
        Providers {
            window: Box::new(SamplerWindow::new(frontmost, platform.env)),
            power: Box::new(LoggedPower {
                inner: platform.power,
                diagnostics: diagnostics.clone(),
            }),
            permission: Arc::new(platform.permission),
            notifier,
            idle_threshold: threshold,
            sampler: Some(Box::new(move |engine, stop| sampler.spawn(engine, stop))),
            display_session,
        }
    }
}
