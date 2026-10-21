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
//! card. When no notification could be shown, the popover plays its own chime instead.

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
        Duration::from_millis(ms.max(MIN_WAIT_MS).unsigned_abs())
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
                let shown = notifier.focus_finished(&alert);
                let _ = FocusEnded {
                    kind: alert.kind.into(),
                    auto_started: alert.auto_started,
                    chime: alert.sound && !shown,
                }
                .emit(app);
                // The end card (or the block that auto-started) waits in the popover.
                windows::show_popover(app);
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
    use application::ports::ActivityRepository;
    use domain::{FocusAllowed, Productivity};

    use super::*;

    const S: i64 = 1_000;
    const MIN: i64 = 60 * S;
    const T0: i64 = 1_000_000_000;

    fn service() -> FocusService {
        let activities = FakeActivities::default();
        activities
            .create("Unassigned", "#999", Productivity::Neutral)
            .unwrap();
        FocusService::new(
            Arc::new(FakeFocus::default()),
            Arc::new(FakeStore::default()),
            Arc::new(activities),
            Arc::new(FakeSettings::default()),
        )
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
        assert_eq!(
            next,
            Some(Duration::from_millis((90 * S + SLACK_MS) as u64))
        );
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
        // Only the planned end is left to wait for.
        assert_eq!(
            next,
            Some(Duration::from_millis(
                (50 * MIN - 100 * S + SLACK_MS) as u64
            ))
        );
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
