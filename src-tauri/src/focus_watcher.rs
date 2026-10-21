//! Watches the running focus session: raises drift alerts and ends the session on time.
//!
//! Same shape as the tray text and goal workers: a thread that sleeps until something can
//! change and never polls. It wakes on events (the app in front changed, tracking paused,
//! idle or resumed, a session was started or edited) and at the next instant the session has
//! something to do (the planned end or the moment a drift alert becomes due).
//!
//! What the user looks at comes from the tracking engine: only while tracking runs and is not
//! degraded is anything observed. Otherwise the drift rule is suspended (the machine receives
//! "nothing observed"), and the session keeps counting down.
//!
//! A drift alert is gentle: a silent system notification (best effort), the tray marker and
//! the card in the popover and the Focus views. It never opens a window or blocks an app.
//!
//! The end of a block is not: a notification with sound, and the popover opens with the end
//! card. When the notification does not reach the user (permission denied or undecided,
//! banners or sounds off, or Kaiflow in front, for which macOS presents nothing), the popover
//! plays its own chime instead. Opening the popover makes Kaiflow the app in front, so after a
//! notification that rings it waits until macOS has presented it (see [`popover_delay`]).
//!
//! The permission is asked when a block starts, so the first end alert can already ring.

use std::sync::Arc;
use std::time::Duration;

use application::engine::{Command, Reply};
use application::focus::FocusService;
use application::ports::{Clock, FocusEndAlert, Notifier, TrackingKind, TrackingStatus};
use crossbeam_channel::{Receiver, RecvTimeoutError, Sender, unbounded};
use domain::{FocusKind, FocusSnapshot, UtcMs};
use tauri::{AppHandle, Manager, Wry};
use tauri_specta::Event;

use crate::composition::AppState;
use crate::ipc::events::{FocusChanged, FocusEnded};
use crate::notifications::{SystemNotifier, TauriToaster};
use crate::tray_text::TrayText;
use crate::windows;

/// Added to every computed wake-up so the deadline has passed when the worker looks.
const SLACK_MS: i64 = 250;
/// Lower bound between two timed evaluations.
const MIN_WAIT_MS: i64 = 500;
/// Events arriving together (close + open + status) are folded into one evaluation.
const DEBOUNCE: Duration = Duration::from_millis(150);
/// Retry delay when the state or the database is not reachable.
const RETRY: Duration = Duration::from_secs(30);
/// Longest timed wait. The wait runs on a monotonic clock that stops while the Mac sleeps;
/// waking up now and then re-reads the wall clock, so a deadline is never missed by more than
/// this even if no event arrives after a sleep.
const MAX_WAIT_MS: i64 = 15_000;
/// How long the popover waits after an end notification that rings. macOS decides whether to
/// present a notification when it delivers it (about 100 ms after it is posted) and presents
/// nothing, sound included, for the app in front, which Kaiflow becomes when the popover opens.
pub const NOTIFICATION_SETTLE: Duration = Duration::from_millis(1_500);

/// What to tell the user after one evaluation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Announce {
    /// Something the windows show changed; they refetch the focus status.
    Changed { active: bool, drifting: bool },
    /// A drift alert is due (notification).
    Drift { intent: String, app_name: String },
    /// The block ran its course (notification, end card, chime).
    Ended(FocusEndAlert),
    /// A minute is left (optional notification).
    HeadsUp {
        kind: FocusKind,
        intent: String,
        sound: bool,
    },
}

/// What the user is looking at, as far as a focus session may know it.
pub fn observed(status: &TrackingStatus) -> Option<&FocusSnapshot> {
    if status.kind == TrackingKind::Running && !status.degraded {
        status.current.as_ref()
    } else {
        None
    }
}

/// One evaluation: feeds the observation to the session and says what to announce and when
/// to look again (`None` waits for the next event only).
pub fn step(
    focus: &FocusService,
    observed: Option<&FocusSnapshot>,
    now: UtcMs,
) -> Result<(Vec<Announce>, Option<Duration>), String> {
    let mut announce = Vec::new();
    if focus.next_deadline().is_some() {
        let outcome = focus.observe(observed, now).map_err(|e| e.to_string())?;
        if let Some((intent, app)) = outcome.alert {
            announce.push(Announce::Drift {
                intent,
                app_name: app.app_name,
            });
        }
        if let Some((kind, intent)) = outcome.heads_up {
            announce.push(Announce::HeadsUp {
                kind,
                intent,
                sound: focus.timer_settings().sound,
            });
        }
        if let Some(ended) = outcome.ended {
            announce.push(Announce::Ended(ended));
        }
        if outcome.changed {
            let tray = focus.tray(now);
            announce.push(Announce::Changed {
                active: tray.is_some(),
                drifting: tray.is_some_and(|t| t.drifting),
            });
        }
    }
    let next = focus.next_deadline().map(|deadline| {
        let ms = deadline.since(now) + SLACK_MS;
        Duration::from_millis(ms.clamp(MIN_WAIT_MS, MAX_WAIT_MS).unsigned_abs())
    });
    Ok((announce, next))
}

enum Msg {
    Refresh,
    Stop,
}

/// Handle to the focus worker; cheap to clone, every call is non-blocking.
#[derive(Clone)]
pub struct FocusWatcher {
    tx: Sender<Msg>,
}

impl FocusWatcher {
    /// Starts the worker; it evaluates once right away. A failed spawn only disables drift
    /// detection and the automatic end: the handle stays usable and its calls do nothing.
    pub fn spawn(app: &AppHandle<Wry>) -> Self {
        let (tx, rx) = unbounded();
        let app = app.clone();
        let spawned = std::thread::Builder::new()
            .name("focus-watcher".into())
            .spawn(move || run(&app, &rx));
        if let Err(error) = spawned {
            eprintln!("could not start the focus watcher thread: {error}");
        }
        Self { tx }
    }

    /// Asks for an evaluation (engine event, session edit). Safe from any thread, the engine
    /// thread included: it never waits.
    pub fn refresh(&self) {
        let _ = self.tx.send(Msg::Refresh);
    }

    /// Ends the worker (app exit). It does not wait for the thread.
    pub fn stop(&self) {
        let _ = self.tx.send(Msg::Stop);
    }
}

fn run(app: &AppHandle<Wry>, rx: &Receiver<Msg>) {
    let notifier = SystemNotifier::new(TauriToaster::new(app.clone()));
    let mut wait = Some(Duration::ZERO);
    // Whether the running session already had its notification permission checked.
    let mut prepared = false;
    loop {
        let woke = match wait {
            Some(timeout) => rx.recv_timeout(timeout),
            None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match woke {
            Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => return,
            Ok(Msg::Refresh) => {
                if !drain(rx) {
                    return;
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
        let Some(state) = app.try_state::<Arc<AppState>>() else {
            wait = Some(RETRY);
            continue;
        };
        wait = match evaluate(&state) {
            Ok((announce, next)) => {
                perform(app, &notifier, announce);
                if next.is_none() {
                    prepared = false;
                } else if !prepared {
                    notifier.prepare();
                    prepared = true;
                }
                next
            }
            Err(error) => {
                eprintln!("focus watcher: {error}");
                Some(RETRY)
            }
        };
    }
}

/// Swallows the burst of refresh requests following the first one; `false` on stop.
fn drain(rx: &Receiver<Msg>) -> bool {
    loop {
        match rx.recv_timeout(DEBOUNCE) {
            Ok(Msg::Refresh) => {}
            Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => return false,
            Err(RecvTimeoutError::Timeout) => return true,
        }
    }
}

fn evaluate(state: &AppState) -> Result<(Vec<Announce>, Option<Duration>), String> {
    // Nothing to watch: skip the round trip to the engine.
    if state.focus.next_deadline().is_none() {
        return Ok((Vec::new(), None));
    }
    let status = match state
        .engine
        .request(Command::GetStatus)
        .map_err(|e| format!("engine: {e:?}"))?
    {
        Reply::Status(status) => status,
        other => return Err(format!("unexpected engine reply: {other:?}")),
    };
    step(&state.focus, observed(&status), state.clock.now())
}

/// What the popover hears at the end of a block: it chimes when sound is on and the system
/// notification did not ring.
pub fn ended_event(alert: &FocusEndAlert, shown: bool) -> FocusEnded {
    FocusEnded {
        kind: alert.kind.into(),
        auto_started: alert.auto_started,
        chime: alert.sound && !shown,
    }
}

/// When the popover opens after the end notification: right away when the notification will
/// not ring (the popover chimes instead), after [`NOTIFICATION_SETTLE`] otherwise.
pub fn popover_delay(shown: bool) -> Duration {
    if shown {
        NOTIFICATION_SETTLE
    } else {
        Duration::ZERO
    }
}

fn perform(app: &AppHandle<Wry>, notifier: &dyn Notifier, announce: Vec<Announce>) {
    let changed = !announce.is_empty();
    for item in announce {
        match item {
            Announce::Drift { intent, app_name } => notifier.focus_drift(&intent, &app_name),
            Announce::HeadsUp {
                kind,
                intent,
                sound,
            } => notifier.focus_heads_up(kind, &intent, sound),
            Announce::Ended(alert) => {
                // Notify first: Kaiflow must not be in front when macOS presents it.
                let shown = notifier.focus_finished(&alert);
                let event = ended_event(&alert, shown);
                if event.chime {
                    eprintln!(
                        "focus watcher: the end notification did not ring, the popover chimes"
                    );
                }
                if let Err(error) = event.emit(app) {
                    eprintln!("focus watcher: could not send the end of the block: {error}");
                }
                // The end card (or the block that auto-started) waits in the popover.
                windows::show_popover_after(app, popover_delay(shown));
            }
            Announce::Changed { active, drifting } => {
                let _ = FocusChanged { active, drifting }.emit(app);
            }
        }
    }
    // The tray shows the countdown and the drift marker.
    if changed && let Some(tray_text) = app.try_state::<TrayText>() {
        tray_text.refresh();
    }
}

#[cfg(test)]
mod tests {
    use application::fakes::{FakeActivities, FakeFocus, FakeSettings, FakeStore};
    use application::focus::StartRequest;
    use application::ports::{ActivityRepository, SettingsRepository};
    use domain::{FocusAllowed, Productivity};

    use super::*;

    const S: i64 = 1_000;
    const MIN: i64 = 60 * S;
    const T0: i64 = 1_000_000_000;

    fn service() -> FocusService {
        service_with(FakeSettings::default())
    }

    fn service_with(settings: FakeSettings) -> FocusService {
        let activities = FakeActivities::default();
        activities
            .create("Unassigned", "#999", Productivity::Neutral)
            .unwrap();
        FocusService::new(
            Arc::new(FakeFocus::default()),
            Arc::new(FakeStore::default()),
            Arc::new(activities),
            Arc::new(settings),
        )
    }

    /// Runs the worker loop against a fake clock: every evaluation happens exactly when the
    /// previous one asked to wake up, with no event in between (the app sits idle). Returns
    /// the instants at which something was announced.
    fn run_idle(focus: &FocusService, from: i64, until: i64) -> Vec<(i64, Vec<Announce>)> {
        let mut now = from;
        let mut announced = Vec::new();
        while now <= until {
            let (announce, next) = step(focus, None, UtcMs(now)).unwrap();
            if !announce.is_empty() {
                announced.push((now, announce));
            }
            let Some(wait) = next else { break };
            now += i64::try_from(wait.as_millis()).unwrap();
        }
        announced
    }

    fn timer(minutes: i64) -> StartRequest {
        StartRequest {
            kind: FocusKind::Timer,
            intent: String::new(),
            planned_ms: minutes * MIN,
            allowed: FocusAllowed::default(),
        }
    }

    fn app(id: &str) -> FocusSnapshot {
        FocusSnapshot {
            app_id: id.into(),
            app_name: id.to_uppercase(),
            pid: 1,
            window_title: None,
        }
    }

    fn begin(focus: &FocusService, current: Option<&FocusSnapshot>) {
        focus
            .start(
                StartRequest {
                    kind: FocusKind::Focus,
                    intent: "Write report".into(),
                    planned_ms: 50 * MIN,
                    allowed: FocusAllowed {
                        activities: Vec::new(),
                        apps: vec!["excel".into()],
                    },
                },
                None,
                current,
                UtcMs(T0),
            )
            .unwrap();
    }

    fn status(kind: TrackingKind, degraded: bool, current: Option<&str>) -> TrackingStatus {
        TrackingStatus {
            kind,
            current: current.map(app),
            since: None,
            degraded,
        }
    }

    #[test]
    fn only_a_healthy_running_tracker_observes_anything() {
        assert_eq!(
            observed(&status(TrackingKind::Running, false, Some("slack"))),
            Some(&app("slack"))
        );
        for (kind, degraded) in [
            (TrackingKind::Paused, false),
            (TrackingKind::Idle, false),
            (TrackingKind::Asleep, false),
            (TrackingKind::Stopped, false),
            (TrackingKind::Running, true),
        ] {
            assert_eq!(observed(&status(kind, degraded, Some("slack"))), None);
        }
        assert_eq!(observed(&status(TrackingKind::Running, false, None)), None);
    }

    #[test]
    fn without_a_session_it_waits_for_events_only() {
        let focus = service();
        let (announce, next) = step(&focus, Some(&app("slack")), UtcMs(T0)).unwrap();
        assert!(announce.is_empty());
        assert_eq!(next, None);
    }

    #[test]
    fn it_wakes_when_the_drift_alert_would_be_due() {
        let focus = service();
        begin(&focus, Some(&app("excel")));
        let (announce, next) = step(&focus, Some(&app("slack")), UtcMs(T0 + 10 * S)).unwrap();
        assert!(announce.is_empty());
        // Far deadlines are approached in bounded steps (the wait clock stops in sleep).
        assert_eq!(next, Some(Duration::from_millis(MAX_WAIT_MS as u64)));
        let (_, near) = step(&focus, Some(&app("slack")), UtcMs(T0 + 95 * S)).unwrap();
        assert_eq!(near, Some(Duration::from_millis((5 * S + SLACK_MS) as u64)));
    }

    #[test]
    fn a_drift_is_announced_once_with_a_notification_and_a_changed_event() {
        let focus = service();
        begin(&focus, Some(&app("excel")));
        step(&focus, Some(&app("slack")), UtcMs(T0 + 10 * S)).unwrap();
        let (announce, _) = step(&focus, Some(&app("slack")), UtcMs(T0 + 101 * S)).unwrap();
        assert_eq!(
            announce,
            vec![
                Announce::Drift {
                    intent: "Write report".into(),
                    app_name: "SLACK".into()
                },
                Announce::Changed {
                    active: true,
                    drifting: true
                }
            ]
        );
        let (again, _) = step(&focus, Some(&app("slack")), UtcMs(T0 + 102 * S)).unwrap();
        assert!(again.is_empty(), "never twice for one stretch");
    }

    #[test]
    fn pausing_tracking_clears_the_alert_and_suspends_the_rule() {
        let focus = service();
        begin(&focus, Some(&app("slack")));
        step(&focus, Some(&app("slack")), UtcMs(T0 + 91 * S)).unwrap();
        let (announce, next) = step(&focus, None, UtcMs(T0 + 100 * S)).unwrap();
        assert_eq!(
            announce,
            vec![Announce::Changed {
                active: true,
                drifting: false
            }]
        );
        // Only the planned end is left to wait for (in bounded steps).
        assert_eq!(next, Some(Duration::from_millis(MAX_WAIT_MS as u64)));
        assert_eq!(focus.next_deadline(), Some(UtcMs(T0 + 50 * MIN)));
    }

    #[test]
    fn an_idle_app_ends_the_block_within_a_second_of_its_planned_end() {
        let focus = service();
        focus.start(timer(25), None, None, UtcMs(T0)).unwrap();
        let announced = run_idle(&focus, T0, T0 + 30 * MIN);
        let [(at, announce)] = announced.as_slice() else {
            panic!("one announcement expected: {announced:?}");
        };
        let end = T0 + 25 * MIN;
        assert!((end..end + S).contains(at), "ended at {at}, planned {end}");
        assert!(matches!(announce[0], Announce::Ended(ref alert) if alert.sound));
    }

    #[test]
    fn the_heads_up_and_the_end_both_ring_on_time_without_events() {
        let settings = FakeSettings::default();
        settings
            .set("focus_timer", r#"{"heads_up": true, "sound": true}"#)
            .unwrap();
        let focus = service_with(settings);
        focus.start(timer(5), None, None, UtcMs(T0)).unwrap();
        let announced = run_idle(&focus, T0, T0 + 10 * MIN);
        assert_eq!(announced.len(), 2, "{announced:?}");
        let (heads_up_at, heads_up) = &announced[0];
        assert!((T0 + 4 * MIN..T0 + 4 * MIN + S).contains(heads_up_at));
        assert_eq!(
            heads_up[0],
            Announce::HeadsUp {
                kind: FocusKind::Timer,
                intent: String::new(),
                sound: true
            }
        );
        let (end_at, end) = &announced[1];
        assert!((T0 + 5 * MIN..T0 + 5 * MIN + S).contains(end_at));
        assert!(matches!(end[0], Announce::Ended(_)));
    }

    #[test]
    fn the_popover_waits_for_a_notification_that_rings_and_not_for_one_that_does_not() {
        // Opening it right away would make Kaiflow the app in front before macOS presents the
        // notification, which then lands in Notification Center without banner or sound.
        assert!(popover_delay(true) >= Duration::from_millis(500));
        // Nothing to wait for: the popover is the alert (with its chime).
        assert_eq!(popover_delay(false), Duration::ZERO);
    }

    #[test]
    fn the_popover_chimes_only_when_the_notification_did_not_ring() {
        let alert = FocusEndAlert {
            kind: FocusKind::Timer,
            intent: String::new(),
            next: None,
            auto_started: false,
            sound: true,
        };
        assert!(!ended_event(&alert, true).chime);
        assert!(ended_event(&alert, false).chime);
        let silent = FocusEndAlert {
            sound: false,
            ..alert
        };
        assert!(!ended_event(&silent, false).chime, "sound is off");
    }

    #[test]
    fn the_planned_end_finishes_the_session_and_stops_the_timer() {
        let focus = service();
        begin(&focus, None);
        let (announce, next) = step(&focus, None, UtcMs(T0 + 50 * MIN + S)).unwrap();
        assert_eq!(
            announce,
            vec![
                Announce::Ended(FocusEndAlert {
                    kind: FocusKind::Focus,
                    intent: "Write report".into(),
                    next: Some((FocusKind::Break, 5 * MIN)),
                    auto_started: false,
                    sound: true,
                }),
                Announce::Changed {
                    active: false,
                    drifting: false
                }
            ]
        );
        assert_eq!(next, None);
    }
}
