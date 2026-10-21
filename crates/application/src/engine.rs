//! The single engine thread (design sections 1 and 6): owns the machine, the write
//! repository and the pending gaps; consumes signals, IPC commands and ticks.

use std::thread::JoinHandle;

use crossbeam_channel::{Receiver, Sender, bounded, select, unbounded};
use domain::{
    Event, GapId, IdleGap, IdleResolution, PrivacyPolicy, TrackingMachine, UtcMs, apply_privacy,
    machine::State,
};

use crate::effects_executor::{EffectsExecutor, ResolveError};
use crate::idle_policy::IdlePolicy;
use crate::ports::{
    ActiveWindowProvider, Clock, EventSink, Notifier, PrivacyRepository, SessionRepository,
    SystemSignal, TrackingKind, TrackingStatus,
};

pub struct Ports {
    pub clock: Box<dyn Clock>,
    pub window: Box<dyn ActiveWindowProvider>,
    pub sessions: Box<dyn SessionRepository>,
    pub privacy: Box<dyn PrivacyRepository>,
    pub sink: Box<dyn EventSink>,
    pub notifier: Box<dyn Notifier>,
    /// Live idle-prompt policy; settings updates change it while the engine runs.
    pub idle_policy: IdlePolicy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Start,
    Pause,
    Resume,
    Stop,
    GetStatus,
    ListPendingGaps,
    ResolveGap {
        id: GapId,
        resolution: IdleResolution,
    },
    /// Re-read the privacy policy after settings or rules changed (future snapshots only).
    ReloadPrivacy,
    /// Close the open segment with `Shutdown` and stop the thread.
    Shutdown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reply {
    Status(TrackingStatus),
    PendingGaps(Vec<IdleGap>),
    Done,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineError {
    Resolve(ResolveError),
    /// The engine thread is gone.
    Stopped,
}

pub struct Request {
    pub command: Command,
    pub reply: Sender<Result<Reply, EngineError>>,
}

/// Cloneable entry point for adapters (signals, ticks) and the IPC layer (commands).
#[derive(Clone)]
pub struct EngineHandle {
    signals: Sender<SystemSignal>,
    commands: Sender<Request>,
    ticks: Sender<()>,
}

impl EngineHandle {
    pub fn signals(&self) -> Sender<SystemSignal> {
        self.signals.clone()
    }

    pub fn signal(&self, signal: SystemSignal) {
        let _ = self.signals.send(signal);
    }

    pub fn tick(&self) {
        let _ = self.ticks.send(());
    }

    /// Sends a command and waits for the engine's reply.
    pub fn request(&self, command: Command) -> Result<Reply, EngineError> {
        let (reply, rx) = bounded(1);
        self.commands
            .send(Request { command, reply })
            .map_err(|_| EngineError::Stopped)?;
        rx.recv().map_err(|_| EngineError::Stopped)?
    }
}

pub struct Engine {
    machine: TrackingMachine,
    executor: EffectsExecutor,
    clock: Box<dyn Clock>,
    window: Box<dyn ActiveWindowProvider>,
    privacy: Box<dyn PrivacyRepository>,
    policy: PrivacyPolicy,
    signals: Receiver<SystemSignal>,
    commands: Receiver<Request>,
    ticks: Receiver<()>,
}

impl Engine {
    pub fn new(ports: Ports) -> (Self, EngineHandle) {
        let (signals_tx, signals) = unbounded();
        let (commands_tx, commands) = unbounded();
        let (ticks_tx, ticks) = unbounded();
        let engine = Self {
            machine: TrackingMachine::new(),
            executor: EffectsExecutor::new(
                ports.sessions,
                ports.sink,
                ports.notifier,
                ports.idle_policy,
            ),
            clock: ports.clock,
            window: ports.window,
            privacy: ports.privacy,
            policy: PrivacyPolicy::default(),
            signals,
            commands,
            ticks,
        };
        let handle = EngineHandle {
            signals: signals_tx,
            commands: commands_tx,
            ticks: ticks_tx,
        };
        (engine, handle)
    }

    pub fn spawn(self) -> std::io::Result<JoinHandle<()>> {
        std::thread::Builder::new()
            .name("engine".into())
            .spawn(move || self.run())
    }

    /// Blocks until `Shutdown` or until every sender is dropped.
    pub fn run(mut self) {
        self.startup();
        loop {
            let keep_going = select! {
                recv(self.signals) -> msg => msg.map(|s| self.on_signal(s)).is_ok(),
                recv(self.commands) -> msg => msg.map(|r| self.on_request(r)).unwrap_or(false),
                recv(self.ticks) -> msg => msg.map(|()| self.on_tick()).is_ok(),
            };
            if !keep_going {
                break;
            }
        }
        self.shutdown();
    }

    /// Orphan recovery, gap expiry and policy load (R4.3, S1).
    fn startup(&mut self) {
        let now = self.clock.now();
        self.executor.recover(now);
        self.reload_policy();
    }

    fn reload_policy(&mut self) {
        match self.privacy.load_policy() {
            Ok(policy) => self.policy = policy,
            Err(e) => self.executor.report(e),
        }
    }

    fn feed(&mut self, event: Event, now: UtcMs) {
        let effects = self.machine.on(event, now);
        let status = status_of(&self.machine);
        self.executor.execute(effects, &status, now);
    }

    fn on_signal(&mut self, signal: SystemSignal) {
        let now = self.clock.now();
        let event = match signal {
            SystemSignal::Focus(raw) => Event::Focus(self.filtered(raw)),
            SystemSignal::IdleDetected { since } => Event::IdleDetected { since },
            SystemSignal::ActivityResumed => Event::ActivityResumed,
            SystemSignal::WillSleep => Event::WillSleep,
            SystemSignal::DidWake => Event::DidWake,
            SystemSignal::ScreenLocked => Event::ScreenLocked,
            SystemSignal::ScreenUnlocked => Event::ScreenUnlocked,
            SystemSignal::PowerOff => Event::PowerOff,
            SystemSignal::PermissionChanged(state) => Event::PermissionChanged(state),
        };
        self.feed(event, now);
    }

    fn on_tick(&mut self) {
        let now = self.clock.now();
        self.feed(Event::Heartbeat, now);
        self.executor.expire_due(now);
    }

    /// Returns whether the loop should keep running.
    fn on_request(&mut self, request: Request) -> bool {
        let now = self.clock.now();
        let mut keep_going = true;
        let result = match request.command {
            Command::Start => Ok(self.transition(Event::Start, now)),
            Command::Resume => Ok(self.transition(Event::Resume, now)),
            Command::Pause => Ok(self.transition(Event::Pause, now)),
            Command::Stop => Ok(self.transition(Event::Stop, now)),
            Command::GetStatus => Ok(Reply::Status(status_of(&self.machine))),
            Command::ListPendingGaps => {
                Ok(Reply::PendingGaps(self.executor.pending_gaps().to_vec()))
            }
            Command::ResolveGap { id, resolution } => self
                .executor
                .resolve_gap(id, resolution, now)
                .map(|()| Reply::Done)
                .map_err(EngineError::Resolve),
            Command::ReloadPrivacy => {
                self.reload_policy();
                Ok(Reply::Done)
            }
            Command::Shutdown => {
                self.shutdown();
                keep_going = false;
                Ok(Reply::Done)
            }
        };
        let _ = request.reply.send(result);
        keep_going
    }

    /// Start/Resume read the current window first so the segment opens with real focus.
    fn transition(&mut self, event: Event, now: UtcMs) -> Reply {
        if matches!(event, Event::Start | Event::Resume)
            && matches!(self.machine.state(), State::Stopped | State::Paused)
        {
            let focus = self.filtered(self.window.current());
            self.feed(Event::Focus(focus), now);
        }
        self.feed(event, now);
        Reply::Status(status_of(&self.machine))
    }

    fn filtered(&self, raw: Option<domain::FocusSnapshot>) -> Option<domain::FocusSnapshot> {
        raw.and_then(|snapshot| apply_privacy(snapshot, &self.policy))
    }

    /// Idempotent: closes any open segment with `Shutdown`.
    fn shutdown(&mut self) {
        let now = self.clock.now();
        self.feed(Event::PowerOff, now);
    }
}

pub fn status_of(machine: &TrackingMachine) -> TrackingStatus {
    let (kind, current, since) = match machine.state() {
        State::Stopped => (TrackingKind::Stopped, None, None),
        State::Running { open, .. } => (
            TrackingKind::Running,
            open.as_ref().map(|o| o.focus.clone()),
            open.as_ref().map(|o| o.opened_at),
        ),
        State::Paused => (TrackingKind::Paused, None, None),
        State::Idle { since, prev_focus } => (TrackingKind::Idle, prev_focus.clone(), Some(*since)),
        State::Asleep { .. } => (TrackingKind::Asleep, None, None),
    };
    TrackingStatus {
        kind,
        current,
        since,
        degraded: machine.is_degraded(),
    }
}

#[cfg(test)]
mod tests {
    use domain::{
        DEFAULT_IDLE_PROMPT_TIMEOUT_MS, EndReason, FocusSnapshot, GapStatus, PermissionState,
        Segment, SegmentId, SegmentSource,
    };

    use super::*;
    use crate::fakes::{
        FakeClock, FakePrivacy, FakeStore, FakeWindow, RecordingNotifier, RecordingSink,
    };
    use crate::ports::{DomainEvent, PrivacyMode};

    struct Rig {
        engine: Engine,
        handle: EngineHandle,
        clock: FakeClock,
        window: FakeWindow,
        store: FakeStore,
        privacy: FakePrivacy,
        sink: RecordingSink,
        notifier: RecordingNotifier,
    }

    fn rig_with(store: FakeStore) -> Rig {
        let clock = FakeClock::at(1_000_000);
        let (window, privacy) = (FakeWindow::default(), FakePrivacy::default());
        let (sink, notifier) = (RecordingSink::default(), RecordingNotifier::default());
        let (engine, handle) = Engine::new(Ports {
            clock: Box::new(clock.clone()),
            window: Box::new(window.clone()),
            sessions: Box::new(store.clone()),
            privacy: Box::new(privacy.clone()),
            sink: Box::new(sink.clone()),
            notifier: Box::new(notifier.clone()),
            idle_policy: IdlePolicy::new(600, 0),
        });
        Rig {
            engine,
            handle,
            clock,
            window,
            store,
            privacy,
            sink,
            notifier,
        }
    }

    fn rig() -> Rig {
        let mut r = rig_with(FakeStore::default());
        r.engine.startup();
        r
    }

    fn focus(app: &str, title: Option<&str>) -> FocusSnapshot {
        FocusSnapshot {
            app_id: format!("com.{app}"),
            app_name: app.into(),
            pid: 1,
            window_title: title.map(Into::into),
        }
    }

    impl Rig {
        fn signal(&mut self, s: SystemSignal) {
            self.engine.on_signal(s);
        }
        fn status(&mut self) -> TrackingStatus {
            status_of(&self.engine.machine)
        }
        fn start_on(&mut self, app: &str) {
            self.window.set(Some(focus(app, None)));
            self.engine.transition(Event::Start, self.clock.now_ms());
        }
    }

    impl FakeClock {
        fn now_ms(&self) -> UtcMs {
            Clock::now(self)
        }
    }

    #[test]
    fn start_opens_a_segment_with_the_current_window() {
        let mut r = rig();
        r.start_on("a");
        let segs = r.store.segments();
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].app_id.as_deref(), Some("com.a"));
        assert_eq!(r.status().kind, TrackingKind::Running);
        assert_eq!(r.status().current, Some(focus("a", None)));
    }

    #[test]
    fn focus_change_closes_and_opens_with_the_clock_time() {
        let mut r = rig();
        r.start_on("a");
        r.clock.advance(5_000);
        r.signal(SystemSignal::Focus(Some(focus("b", None))));
        let segs = r.store.segments();
        assert_eq!(segs[0].ended_at, Some(UtcMs(1_005_000)));
        assert_eq!(segs[0].end_reason, Some(EndReason::FocusChange));
        assert_eq!(segs[1].started_at, UtcMs(1_005_000));
        assert!(segs[1].ended_at.is_none());
    }

    #[test]
    fn privacy_is_applied_before_the_machine_sees_focus() {
        let mut r = rig();
        r.privacy
            .set_mode("com.secret", Some(PrivacyMode::Exclude))
            .unwrap();
        r.privacy
            .set_mode("com.bank", Some(PrivacyMode::RedactTitle))
            .unwrap();
        r.engine.reload_policy();
        r.start_on("a");

        r.signal(SystemSignal::Focus(Some(focus("secret", Some("x")))));
        let open = r
            .store
            .segments()
            .into_iter()
            .filter(|s| s.ended_at.is_none())
            .count();
        assert_eq!(open, 0, "excluded app records nothing");

        r.signal(SystemSignal::Focus(Some(focus("bank", Some("balance")))));
        let last = r.store.segments().pop().unwrap();
        assert_eq!(last.app_id.as_deref(), Some("com.bank"));
        assert_eq!(last.window_title, None, "title redacted");
    }

    #[test]
    fn privacy_changes_apply_to_future_snapshots_only() {
        let mut r = rig();
        r.start_on("a");
        r.signal(SystemSignal::Focus(Some(focus("a", Some("t1")))));
        r.privacy.set_store_titles(false);
        r.engine.reload_policy();
        r.signal(SystemSignal::Focus(Some(focus("a", Some("t2")))));
        let titles: Vec<_> = r
            .store
            .segments()
            .iter()
            .map(|s| s.window_title.clone())
            .collect();
        assert_eq!(titles, vec![None, Some("t1".into()), None]);
    }

    #[test]
    fn idle_return_creates_a_gap_then_tick_expires_it_after_ten_minutes() {
        let mut r = rig();
        r.start_on("a");
        r.clock.advance(400_000);
        r.signal(SystemSignal::IdleDetected {
            since: UtcMs(r.clock.now_ms().0 - 300_000),
        });
        r.clock.advance(300_000);
        r.signal(SystemSignal::ActivityResumed);
        assert_eq!(r.engine.executor.pending_gaps().len(), 1);
        assert_eq!(
            r.notifier
                .idle_returns
                .load(std::sync::atomic::Ordering::SeqCst),
            1
        );
        assert!(
            r.sink
                .events()
                .iter()
                .any(|e| matches!(e, DomainEvent::IdleGapPending(_)))
        );

        r.clock.advance(DEFAULT_IDLE_PROMPT_TIMEOUT_MS - 1);
        r.engine.on_tick();
        assert_eq!(r.engine.executor.pending_gaps().len(), 1);
        r.clock.advance(1);
        r.engine.on_tick();
        assert!(r.engine.executor.pending_gaps().is_empty());
        assert_eq!(r.store.gaps()[0].status, GapStatus::Expired);
    }

    #[test]
    fn resolve_command_assigns_idle_time_to_the_previous_app() {
        let mut r = rig();
        r.start_on("a");
        r.clock.advance(400_000);
        r.signal(SystemSignal::IdleDetected {
            since: UtcMs(1_100_000),
        });
        r.clock.advance(300_000);
        r.signal(SystemSignal::ActivityResumed);
        let id = r.engine.executor.pending_gaps()[0].id.unwrap();

        let (reply, rx) = bounded(1);
        let keep = r.engine.on_request(Request {
            command: Command::ResolveGap {
                id,
                resolution: IdleResolution::AssignPrevious,
            },
            reply,
        });
        assert!(keep);
        assert_eq!(rx.recv().unwrap(), Ok(Reply::Done));
        let assigned: Vec<_> = r
            .store
            .segments()
            .into_iter()
            .filter(|s| s.source == SegmentSource::IdleAssigned)
            .collect();
        assert_eq!(assigned.len(), 1);
        assert_eq!(assigned[0].app_id.as_deref(), Some("com.a"));
        assert_eq!(assigned[0].started_at, UtcMs(1_100_000));
    }

    #[test]
    fn startup_recovers_orphans_and_expires_pending_gaps() {
        let store = FakeStore::default();
        store.seed_segment(Segment {
            id: SegmentId(0),
            started_at: UtcMs(10),
            ended_at: None,
            heartbeat_at: UtcMs(90),
            app_id: Some("com.a".into()),
            app_name: Some("A".into()),
            window_title: None,
            end_reason: None,
            source: SegmentSource::Tracked,
            activity_id: None,
        });
        store.seed_gap(IdleGap::pending(UtcMs(0), UtcMs(5), None, UtcMs(5)));
        let mut r = rig_with(store);
        r.engine.startup();
        let seg = &r.store.segments()[0];
        assert_eq!(
            (seg.ended_at, seg.end_reason),
            (Some(UtcMs(90)), Some(EndReason::Recovered))
        );
        assert_eq!(r.store.gaps()[0].status, GapStatus::Expired);
        assert!(r.engine.executor.pending_gaps().is_empty());
    }

    #[test]
    fn permission_denied_degrades_and_granted_restores() {
        let mut r = rig();
        r.signal(SystemSignal::PermissionChanged(PermissionState::Denied));
        assert!(r.status().degraded);
        let events = r.sink.events();
        assert!(events.contains(&DomainEvent::PermissionChanged(PermissionState::Denied)));
        assert!(
            events
                .iter()
                .any(|e| matches!(e, DomainEvent::TrackingStatusChanged(s) if s.degraded))
        );
        assert_eq!(
            r.notifier
                .revocations
                .load(std::sync::atomic::Ordering::SeqCst),
            1
        );

        r.signal(SystemSignal::PermissionChanged(PermissionState::Granted));
        assert!(!r.status().degraded);
    }

    #[test]
    fn sleep_and_wake_through_signals_reopen_with_current_focus() {
        let mut r = rig();
        r.start_on("a");
        r.clock.advance(1_000);
        r.signal(SystemSignal::WillSleep);
        assert_eq!(r.status().kind, TrackingKind::Asleep);
        r.clock.advance(3_600_000);
        r.signal(SystemSignal::DidWake);
        let segs = r.store.segments();
        assert_eq!(segs[0].end_reason, Some(EndReason::Sleep));
        assert_eq!(segs[0].ended_at, Some(UtcMs(1_001_000)));
        assert_eq!(segs[1].started_at, UtcMs(4_601_000));
    }

    #[test]
    fn ticks_refresh_the_heartbeat_of_the_open_segment() {
        let mut r = rig();
        r.start_on("a");
        r.clock.advance(2_000);
        r.engine.on_tick();
        assert_eq!(r.store.segments()[0].heartbeat_at, UtcMs(1_002_000));
    }

    #[test]
    fn pause_and_resume_commands_round_trip() {
        let mut r = rig();
        r.start_on("a");
        r.engine.transition(Event::Pause, r.clock.now_ms());
        assert_eq!(r.status().kind, TrackingKind::Paused);
        r.window.set(Some(focus("c", None)));
        r.engine.transition(Event::Resume, r.clock.now_ms());
        assert_eq!(
            r.store.segments().last().unwrap().app_id.as_deref(),
            Some("com.c")
        );
    }

    #[test]
    fn run_loop_serves_commands_signals_and_ticks_then_shuts_down_cleanly() {
        let r = rig_with(FakeStore::default());
        let (store, clock, window) = (r.store.clone(), r.clock.clone(), r.window.clone());
        let handle = r.handle.clone();
        let thread = r.engine.spawn().unwrap();

        window.set(Some(focus("a", None)));
        assert!(matches!(
            handle.request(Command::Start),
            Ok(Reply::Status(TrackingStatus {
                kind: TrackingKind::Running,
                ..
            }))
        ));
        clock.advance(2_000);
        handle.signal(SystemSignal::Focus(Some(focus("b", None))));
        handle.tick();
        // Signals and commands travel on separate channels and `select!` picks
        // between ready channels at random, so poll until the signal lands.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        let status = loop {
            let Ok(Reply::Status(status)) = handle.request(Command::GetStatus) else {
                panic!("status expected");
            };
            if status.current == Some(focus("b", None)) || std::time::Instant::now() > deadline {
                break status;
            }
            std::thread::yield_now();
        };
        assert_eq!(status.current, Some(focus("b", None)));

        assert_eq!(handle.request(Command::Shutdown), Ok(Reply::Done));
        thread.join().unwrap();
        let last = store.segments().pop().unwrap();
        assert_eq!(last.end_reason, Some(EndReason::Shutdown));
        assert_eq!(
            handle.request(Command::GetStatus),
            Err(EngineError::Stopped)
        );
    }

    #[test]
    fn dropping_every_handle_stops_the_thread_and_closes_the_segment() {
        let r = rig_with(FakeStore::default());
        let store = r.store.clone();
        r.window.set(Some(focus("a", None)));
        let handle = r.handle.clone();
        drop(r.handle);
        let thread = r.engine.spawn().unwrap();
        handle.request(Command::Start).unwrap();
        drop(handle);
        thread.join().unwrap();
        assert_eq!(store.segments()[0].end_reason, Some(EndReason::Shutdown));
    }
}
