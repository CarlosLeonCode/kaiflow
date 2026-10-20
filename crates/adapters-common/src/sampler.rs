//! The 2 s sampler (design section 6, task 2.4), shared by every platform. One thread that
//!
//! - checks on every tick whether window titles may be read and reports changes (live
//!   revocation on macOS, R5.2; a degraded session on Linux/Wayland),
//! - consumes the observer's activations (and, where the platform offers it, re-reads the
//!   foreground window) and reads its title, emitting `Focus` only when `(app, title)`
//!   changes (R1.3),
//! - turns the idle counter into `IdleDetected` / `ActivityResumed`,
//! - sends the engine heartbeat tick.
//!
//! All decisions live in [`SamplerCore`], which is plain Rust over a [`SamplerEnv`], so they
//! are unit tested without a desktop session.

use std::sync::{Arc, Mutex, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use application::engine::EngineHandle;
use application::ports::{ActiveWindowProvider, Clock, SystemSignal};
use crossbeam_channel::{Receiver, select};
use domain::{FocusSnapshot, PermissionState};

use crate::activation::Activation;
use crate::idle::{IdleThreshold, IdleTracker};
use crate::permission::state_from_trusted;

/// Cadence of the sampler and of the engine heartbeat (design section 6).
pub const TICK: Duration = Duration::from_secs(2);

/// What the core needs from the OS; faked in tests.
pub trait SamplerEnv: Send {
    /// Whether window titles may be read (macOS Accessibility, Linux X11 session...).
    fn trusted(&self) -> bool;
    /// Title of the activation's focused window; `None` when it has none or cannot be read.
    fn window_title(&self, activation: &Activation) -> Option<String>;
    fn seconds_since_input(&self) -> f64;
    /// The foreground application right now, for platforms whose activation events can be
    /// missed (Windows, X11): polling on every tick makes the events a latency optimization
    /// only. `None` keeps the last known activation (transient "no foreground window"
    /// states while switching are ignored). macOS relies on its notifications alone.
    fn poll_frontmost(&self) -> Option<Activation> {
        None
    }
}

/// Where the sampler sends its output; the engine in production, a recorder in tests.
pub trait SamplerOutput: Send {
    fn signal(&self, signal: SystemSignal);
    fn tick(&self);
}

impl SamplerOutput for EngineHandle {
    fn signal(&self, signal: SystemSignal) {
        EngineHandle::signal(self, signal);
    }
    fn tick(&self) {
        EngineHandle::tick(self);
    }
}

/// Frontmost application as last seen by the observer; shared with [`SamplerWindow`].
#[derive(Debug, Clone, Default)]
pub struct SharedFrontmost(Arc<Mutex<Option<Activation>>>);

impl SharedFrontmost {
    pub fn new(initial: Option<Activation>) -> Self {
        Self(Arc::new(Mutex::new(initial)))
    }

    pub fn get(&self) -> Option<Activation> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub fn set(&self, activation: Activation) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = Some(activation);
    }
}

/// Builds the snapshot the engine receives. The title is only read with permission.
pub fn snapshot(activation: &Activation, title: Option<String>) -> FocusSnapshot {
    FocusSnapshot {
        app_id: activation.identity.bundle_id.clone(),
        app_name: activation.identity.name.clone(),
        pid: activation.pid,
        window_title: title,
    }
}

/// Focus equality is `(app_id, window_title)` (R1.3); the pid does not matter.
fn same_focus(a: &FocusSnapshot, b: &FocusSnapshot) -> bool {
    a.app_id == b.app_id && a.window_title == b.window_title
}

/// Pure decision logic of one sampler tick.
pub struct SamplerCore {
    frontmost: SharedFrontmost,
    last_focus: Option<FocusSnapshot>,
    /// Starts `true`: the engine assumes granted, so only a denial needs reporting at startup.
    trusted: bool,
    idle: IdleTracker,
}

impl SamplerCore {
    pub fn new(frontmost: SharedFrontmost, threshold: IdleThreshold) -> Self {
        Self {
            frontmost,
            last_focus: None,
            trusted: true,
            idle: IdleTracker::new(threshold),
        }
    }

    /// Signals for one cycle: permission change, idle edge, then focus change.
    pub fn step(
        &mut self,
        env: &dyn SamplerEnv,
        activations: impl IntoIterator<Item = Activation>,
        now: domain::UtcMs,
    ) -> Vec<SystemSignal> {
        let mut out = Vec::new();

        for activation in activations {
            self.frontmost.set(activation);
        }
        if let Some(polled) = env.poll_frontmost() {
            self.frontmost.set(polled);
        }

        let trusted = env.trusted();
        if trusted != self.trusted {
            self.trusted = trusted;
            out.push(SystemSignal::PermissionChanged(state_from_trusted(trusted)));
        }

        if let Some(signal) = self.idle.observe(env.seconds_since_input(), now) {
            out.push(signal);
        }

        if let Some(activation) = self.frontmost.get() {
            let title = if trusted {
                env.window_title(&activation)
            } else {
                None
            };
            let focus = snapshot(&activation, title);
            if !self
                .last_focus
                .as_ref()
                .is_some_and(|last| same_focus(last, &focus))
            {
                self.last_focus = Some(focus.clone());
                out.push(SystemSignal::Focus(Some(focus)));
            }
        }
        out
    }
}

/// The sampler thread's state.
pub struct Sampler<E: SamplerEnv + 'static> {
    core: SamplerCore,
    env: E,
    activations: Receiver<Activation>,
    clock: Box<dyn Clock>,
    period: Duration,
}

impl<E: SamplerEnv + 'static> Sampler<E> {
    pub fn new(
        env: E,
        frontmost: SharedFrontmost,
        threshold: IdleThreshold,
        activations: Receiver<Activation>,
        clock: Box<dyn Clock>,
    ) -> Self {
        Self {
            core: SamplerCore::new(frontmost, threshold),
            env,
            activations,
            clock,
            period: TICK,
        }
    }

    /// Overrides the tick period (tests only need a short one).
    #[must_use]
    pub fn with_period(mut self, period: Duration) -> Self {
        self.period = period;
        self
    }

    /// Runs until `stop` is closed. An activation wakes the loop early so focus changes are
    /// reported promptly; the heartbeat still fires every period.
    pub fn run(mut self, out: &dyn SamplerOutput, stop: &Receiver<()>) {
        let mut next_tick = Instant::now();
        loop {
            let wait = next_tick.saturating_duration_since(Instant::now());
            let mut woken = Vec::new();
            select! {
                recv(stop) -> _ => return,
                recv(self.activations) -> msg => match msg {
                    Ok(activation) => {
                        woken.push(activation);
                        woken.extend(self.activations.try_iter());
                    }
                    // The observer is gone (its thread ended): a disconnected channel is
                    // always ready, so stop selecting on it instead of spinning. Polling
                    // platforms keep tracking; the heartbeat keeps its period.
                    Err(_) => self.activations = crossbeam_channel::never(),
                },
                default(wait) => {}
            }
            for signal in self.core.step(&self.env, woken, self.clock.now()) {
                out.signal(signal);
            }
            if Instant::now() >= next_tick {
                out.tick();
                next_tick = Instant::now() + self.period;
            }
        }
    }

    pub fn spawn(
        self,
        out: impl SamplerOutput + 'static,
        stop: Receiver<()>,
    ) -> std::io::Result<JoinHandle<()>> {
        std::thread::Builder::new()
            .name("sampler".into())
            .spawn(move || self.run(&out, &stop))
    }
}

/// `ActiveWindowProvider` backed by the same data as the sampler, so `Start`/`Resume` read a
/// fresh focus (title included) without waiting for the next tick.
pub struct SamplerWindow<E: SamplerEnv> {
    frontmost: SharedFrontmost,
    env: E,
}

impl<E: SamplerEnv> SamplerWindow<E> {
    pub fn new(frontmost: SharedFrontmost, env: E) -> Self {
        Self { frontmost, env }
    }
}

impl<E: SamplerEnv> ActiveWindowProvider for SamplerWindow<E> {
    fn current(&self) -> Option<FocusSnapshot> {
        let activation = self.env.poll_frontmost().or_else(|| self.frontmost.get())?;
        let title = if self.env.trusted() {
            self.env.window_title(&activation)
        } else {
            None
        };
        Some(snapshot(&activation, title))
    }
}

/// Permission transition as the domain sees it (exposed for callers building DTOs).
pub fn permission_of(signal: &SystemSignal) -> Option<PermissionState> {
    match signal {
        SystemSignal::PermissionChanged(state) => Some(*state),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

    use crossbeam_channel::{bounded, unbounded};
    use domain::UtcMs;

    use super::*;
    use crate::activation::AppIdentity;

    fn act(pid: i32, bundle: &str) -> Activation {
        Activation::of_process(
            pid,
            AppIdentity {
                bundle_id: bundle.into(),
                name: bundle.to_uppercase(),
            },
        )
    }

    struct FakeEnv {
        trusted: Arc<AtomicBool>,
        titles: Mutex<HashMap<i32, String>>,
        idle_ms: Arc<AtomicU64>,
        polled: Mutex<Option<Activation>>,
    }

    impl FakeEnv {
        fn new() -> Self {
            Self {
                trusted: Arc::new(AtomicBool::new(true)),
                titles: Mutex::new(HashMap::new()),
                idle_ms: Arc::new(AtomicU64::new(0)),
                polled: Mutex::new(None),
            }
        }
        fn poll(&self, activation: Option<Activation>) {
            *self.polled.lock().unwrap() = activation;
        }
        fn title(&self, pid: i32, title: &str) {
            self.titles.lock().unwrap().insert(pid, title.into());
        }
    }

    impl SamplerEnv for FakeEnv {
        fn trusted(&self) -> bool {
            self.trusted.load(Ordering::SeqCst)
        }
        fn window_title(&self, activation: &Activation) -> Option<String> {
            self.titles.lock().unwrap().get(&activation.pid).cloned()
        }
        fn seconds_since_input(&self) -> f64 {
            self.idle_ms.load(Ordering::SeqCst) as f64 / 1000.0
        }
        fn poll_frontmost(&self) -> Option<Activation> {
            self.polled.lock().unwrap().clone()
        }
    }

    fn core() -> SamplerCore {
        SamplerCore::new(SharedFrontmost::default(), IdleThreshold::new(300))
    }

    fn focus_of(signal: &SystemSignal) -> &FocusSnapshot {
        match signal {
            SystemSignal::Focus(Some(f)) => f,
            other => panic!("expected a focus signal, got {other:?}"),
        }
    }

    #[test]
    fn nothing_is_emitted_before_the_first_activation() {
        let env = FakeEnv::new();
        assert!(core().step(&env, [], UtcMs(0)).is_empty());
    }

    #[test]
    fn an_activation_emits_focus_with_the_ax_title() {
        let env = FakeEnv::new();
        env.title(7, "Inbox");
        let out = core().step(&env, [act(7, "com.apple.mail")], UtcMs(0));
        assert_eq!(out.len(), 1);
        let focus = focus_of(&out[0]);
        assert_eq!(focus.app_id, "com.apple.mail");
        assert_eq!(focus.pid, 7);
        assert_eq!(focus.window_title.as_deref(), Some("Inbox"));
    }

    #[test]
    fn focus_is_emitted_only_when_app_or_title_changes() {
        let env = FakeEnv::new();
        env.title(7, "Inbox");
        let mut core = core();
        assert_eq!(core.step(&env, [act(7, "mail")], UtcMs(0)).len(), 1);
        assert!(core.step(&env, [], UtcMs(2_000)).is_empty());
        // Same app re-activated with the same title: still nothing.
        assert!(core.step(&env, [act(7, "mail")], UtcMs(4_000)).is_empty());
        // Title changes inside the same app.
        env.title(7, "Drafts");
        let out = core.step(&env, [], UtcMs(6_000));
        assert_eq!(focus_of(&out[0]).window_title.as_deref(), Some("Drafts"));
        // Another app.
        let out = core.step(&env, [act(9, "xcode")], UtcMs(8_000));
        assert_eq!(focus_of(&out[0]).app_id, "xcode");
    }

    #[test]
    fn a_missing_title_is_none_not_an_error() {
        let env = FakeEnv::new();
        let out = core().step(&env, [act(7, "mail")], UtcMs(0));
        assert_eq!(focus_of(&out[0]).window_title, None);
    }

    #[test]
    fn without_permission_titles_are_not_read_and_the_change_is_reported_once() {
        let env = FakeEnv::new();
        env.title(7, "Secret");
        env.trusted.store(false, Ordering::SeqCst);
        let mut core = core();
        let out = core.step(&env, [act(7, "mail")], UtcMs(0));
        assert_eq!(
            out[0],
            SystemSignal::PermissionChanged(PermissionState::Denied)
        );
        assert_eq!(focus_of(&out[1]).window_title, None);
        assert!(core.step(&env, [], UtcMs(2_000)).is_empty());
    }

    #[test]
    fn regaining_permission_is_reported_and_brings_the_title_back() {
        let env = FakeEnv::new();
        env.title(7, "Inbox");
        env.trusted.store(false, Ordering::SeqCst);
        let mut core = core();
        core.step(&env, [act(7, "mail")], UtcMs(0));
        env.trusted.store(true, Ordering::SeqCst);
        let out = core.step(&env, [], UtcMs(2_000));
        assert_eq!(
            out[0],
            SystemSignal::PermissionChanged(PermissionState::Granted)
        );
        assert_eq!(focus_of(&out[1]).window_title.as_deref(), Some("Inbox"));
    }

    #[test]
    fn granted_at_startup_is_silent() {
        let env = FakeEnv::new();
        let out = core().step(&env, [act(7, "mail")], UtcMs(0));
        assert!(
            out.iter()
                .all(|s| !matches!(s, SystemSignal::PermissionChanged(_)))
        );
    }

    #[test]
    fn idle_and_activity_edges_are_emitted_in_between_focus_signals() {
        let env = FakeEnv::new();
        let mut core = core();
        core.step(&env, [act(7, "mail")], UtcMs(0));
        env.idle_ms.store(301_000, Ordering::SeqCst);
        let out = core.step(&env, [], UtcMs(400_000));
        assert_eq!(
            out,
            vec![SystemSignal::IdleDetected {
                since: UtcMs(99_000)
            }]
        );
        env.idle_ms.store(500, Ordering::SeqCst);
        let out = core.step(&env, [], UtcMs(402_000));
        assert_eq!(out, vec![SystemSignal::ActivityResumed]);
    }

    #[test]
    fn the_window_provider_reads_a_fresh_title() {
        let frontmost = SharedFrontmost::new(Some(act(7, "mail")));
        let env = FakeEnv::new();
        env.title(7, "Inbox");
        let window = SamplerWindow::new(frontmost.clone(), env);
        assert_eq!(
            window.current().unwrap().window_title.as_deref(),
            Some("Inbox")
        );
        assert_eq!(
            SamplerWindow::new(SharedFrontmost::default(), FakeEnv::new()).current(),
            None
        );
    }

    #[test]
    fn a_polled_foreground_window_wins_over_a_missed_event() {
        let env = FakeEnv::new();
        env.title(9, "Main.rs");
        let mut core = core();
        core.step(&env, [act(7, "mail")], UtcMs(0));
        // The activation event for app 9 was missed; polling still finds it.
        env.poll(Some(act(9, "code")));
        let out = core.step(&env, [], UtcMs(2_000));
        let focus = focus_of(&out[0]);
        assert_eq!(focus.app_id, "code");
        assert_eq!(focus.window_title.as_deref(), Some("Main.rs"));
    }

    #[test]
    fn a_poll_without_foreground_window_keeps_the_last_focus() {
        let env = FakeEnv::new();
        let mut core = core();
        env.poll(Some(act(7, "mail")));
        assert_eq!(core.step(&env, [], UtcMs(0)).len(), 1);
        env.poll(None);
        assert!(core.step(&env, [], UtcMs(2_000)).is_empty());
    }

    #[test]
    fn the_window_provider_prefers_a_polled_foreground_window() {
        let env = FakeEnv::new();
        env.poll(Some(act(9, "code")));
        let window = SamplerWindow::new(SharedFrontmost::new(Some(act(7, "mail"))), env);
        assert_eq!(window.current().unwrap().app_id, "code");
    }

    #[derive(Default, Clone)]
    struct Recorder {
        signals: Arc<Mutex<Vec<SystemSignal>>>,
        ticks: Arc<AtomicU64>,
    }

    impl SamplerOutput for Recorder {
        fn signal(&self, signal: SystemSignal) {
            self.signals.lock().unwrap().push(signal);
        }
        fn tick(&self) {
            self.ticks.fetch_add(1, Ordering::SeqCst);
        }
    }

    struct FixedClock(i64);
    impl Clock for FixedClock {
        fn now(&self) -> UtcMs {
            UtcMs(self.0)
        }
    }

    #[test]
    fn the_thread_reports_activations_ticks_and_stops_when_the_channel_closes() {
        let (tx, activations) = unbounded();
        let (stop, stop_rx) = bounded::<()>(0);
        let env = FakeEnv::new();
        env.title(7, "Inbox");
        let sampler = Sampler::new(
            env,
            SharedFrontmost::default(),
            IdleThreshold::new(300),
            activations,
            Box::new(FixedClock(1_000)),
        )
        .with_period(Duration::from_millis(10));
        let recorder = Recorder::default();
        let handle = sampler.spawn(recorder.clone(), stop_rx).unwrap();

        tx.send(act(7, "mail")).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while (recorder.signals.lock().unwrap().is_empty()
            || recorder.ticks.load(Ordering::SeqCst) < 2)
            && Instant::now() < deadline
        {
            std::thread::sleep(Duration::from_millis(5));
        }
        drop(stop);
        handle.join().unwrap();

        let signals = recorder.signals.lock().unwrap();
        assert_eq!(signals.len(), 1, "focus must be emitted once: {signals:?}");
        assert_eq!(focus_of(&signals[0]).window_title.as_deref(), Some("Inbox"));
        assert!(recorder.ticks.load(Ordering::SeqCst) >= 2);
    }

    #[derive(Clone, Default)]
    struct CountingEnv(Arc<AtomicU64>);

    impl SamplerEnv for CountingEnv {
        fn trusted(&self) -> bool {
            self.0.fetch_add(1, Ordering::SeqCst);
            true
        }
        fn window_title(&self, _activation: &Activation) -> Option<String> {
            None
        }
        fn seconds_since_input(&self) -> f64 {
            0.0
        }
    }

    #[test]
    fn a_closed_activation_channel_does_not_make_the_thread_spin() {
        let (tx, activations) = unbounded::<Activation>();
        drop(tx);
        let (stop, stop_rx) = bounded::<()>(0);
        let env = CountingEnv::default();
        let steps = env.0.clone();
        let sampler = Sampler::new(
            env,
            SharedFrontmost::default(),
            IdleThreshold::new(300),
            activations,
            Box::new(FixedClock(0)),
        )
        .with_period(Duration::from_millis(50));
        let recorder = Recorder::default();
        let handle = sampler.spawn(recorder.clone(), stop_rx).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        drop(stop);
        handle.join().unwrap();
        // About one step per period (plus the wake-up that notices the closed channel).
        let steps = steps.load(Ordering::SeqCst);
        assert!(steps < 50, "the sampler spun: {steps} steps in 300 ms");
        assert!(recorder.ticks.load(Ordering::SeqCst) >= 2);
    }

    #[test]
    fn permission_of_extracts_only_permission_signals() {
        assert_eq!(
            permission_of(&SystemSignal::PermissionChanged(PermissionState::Denied)),
            Some(PermissionState::Denied)
        );
        assert_eq!(permission_of(&SystemSignal::DidWake), None);
    }
}
