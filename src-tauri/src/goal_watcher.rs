//! Announces goal thresholds as they are crossed.
//!
//! Same shape as the tray text worker: a thread that sleeps until something can change and
//! never polls. It wakes on events (the segment or tracking state changed, a goal was edited)
//! and at the moment the nearest threshold would be crossed if tracking continues, plus at
//! local midnight so daily goals roll over. What it finds is stored in the goal event log
//! first, so a crossing is announced once per period even across restarts; the announcement
//! is an in-app event (the badge) plus a best-effort system notification.
//!
//! Nothing here ever blocks an app: a crossed limit only produces an alert.

use std::sync::Arc;
use std::time::Duration;

use application::engine::{Command, Reply};
use application::goals::GoalService;
use application::ports::{Clock, Notifier, TrackingKind};
use crossbeam_channel::{Receiver, RecvTimeoutError, Sender, unbounded};
use domain::UtcMs;
use tauri::{AppHandle, Manager, Wry};
use tauri_specta::Event;

use crate::composition::AppState;
use crate::ipc::dto::GoalEventKindDto;
use crate::ipc::events::GoalCrossed;
use crate::notifications::{SystemNotifier, TauriToaster};

/// Added to every computed wake-up so the crossing is already visible in the data.
const SLACK_MS: i64 = 1_000;
/// Lower bound between two timed evaluations.
const MIN_WAIT_MS: i64 = 1_000;
/// Events arriving together (close + open + status) are folded into one evaluation.
const DEBOUNCE: Duration = Duration::from_millis(150);
/// Retry delay when the state or the database is not reachable.
const RETRY: Duration = Duration::from_secs(60);

/// One evaluation: announce the new crossings and say when to look again.
///
/// `tracking` tells whether time is being recorded; only then does it make sense to wake for
/// the nearest threshold. The midnight wake-up is always scheduled.
pub fn step(
    goals: &GoalService,
    tracking: bool,
    now: UtcMs,
    notifier: &dyn Notifier,
    emit: &dyn Fn(GoalCrossed),
) -> Result<Duration, String> {
    let evaluation = goals.evaluate(now).map_err(|e| e.to_string())?;
    for crossing in evaluation.crossings {
        notifier.goal_crossed(&crossing.goal.label, crossing.kind);
        emit(GoalCrossed {
            goal_id: crossing.goal.id,
            label: crossing.goal.label,
            kind: GoalEventKindDto::from(crossing.kind),
        });
    }
    let midnight = evaluation.until_midnight_ms + SLACK_MS;
    let wake = match evaluation.next_crossing_ms.filter(|_| tracking) {
        Some(ms) => (ms + SLACK_MS).min(midnight),
        None => midnight,
    };
    Ok(Duration::from_millis(wake.max(MIN_WAIT_MS).unsigned_abs()))
}

enum Msg {
    Refresh,
    Stop,
}

/// Handle to the goal worker; cheap to clone, every call is non-blocking.
#[derive(Clone)]
pub struct GoalWatcher {
    tx: Sender<Msg>,
}

impl GoalWatcher {
    /// Starts the worker; it evaluates once right away. A failed spawn only disables the
    /// alerts: the handle stays usable and its calls do nothing.
    pub fn spawn(app: &AppHandle<Wry>) -> Self {
        let (tx, rx) = unbounded();
        let app = app.clone();
        let spawned = std::thread::Builder::new()
            .name("goal-watcher".into())
            .spawn(move || run(&app, &rx));
        if let Err(error) = spawned {
            eprintln!("could not start the goal watcher thread: {error}");
        }
        Self { tx }
    }

    /// Asks for an evaluation (engine event, goal edit). Safe from any thread, the engine
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
        wait = match evaluate(&state, &notifier, &|event| {
            let _ = event.emit(app);
        }) {
            Ok(next) => Some(next),
            Err(error) => {
                eprintln!("goal watcher: {error}");
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

fn evaluate(
    state: &AppState,
    notifier: &dyn Notifier,
    emit: &dyn Fn(GoalCrossed),
) -> Result<Duration, String> {
    let tracking = match state
        .engine
        .request(Command::GetStatus)
        .map_err(|e| format!("engine: {e:?}"))?
    {
        Reply::Status(status) => status.kind == TrackingKind::Running,
        other => return Err(format!("unexpected engine reply: {other:?}")),
    };
    step(&state.goals, tracking, state.clock.now(), notifier, emit)
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use application::fakes::{
        FakeActivities, FakeGoals, FakeSettings, FakeStore, FixedCalendar, RecordingNotifier,
    };
    use domain::{EndReason, Goal, GoalKind, GoalScope, Period, Segment, SegmentId, SegmentSource};

    use super::*;

    const MIN: i64 = 60_000;
    const HOUR: i64 = 60 * MIN;
    const DAY: i64 = 24 * HOUR;
    const D0: i64 = 100 * DAY;

    struct Rig {
        goals: GoalService,
        store: FakeStore,
        notifier: RecordingNotifier,
        events: Arc<Mutex<Vec<GoalCrossed>>>,
    }

    fn rig() -> Rig {
        let store = FakeStore::default();
        let goals = GoalService::new(
            Arc::new(FakeGoals::default()),
            Arc::new(store.clone()),
            Arc::new(FakeActivities::default()),
            Arc::new(FakeSettings::default()),
            Arc::new(FixedCalendar::fixed(0)),
        );
        Rig {
            goals,
            store,
            notifier: RecordingNotifier::default(),
            events: Arc::default(),
        }
    }

    impl Rig {
        fn add(&self, kind: GoalKind, target_ms: i64) {
            self.goals
                .save(
                    Goal {
                        id: 0,
                        label: "Email".into(),
                        scope: GoalScope::App("mail".into()),
                        period: Period::Daily,
                        kind,
                        target_ms,
                        active_days: domain::calendar::ALL_DAYS,
                        archived: false,
                        created_at: UtcMs(0),
                    },
                    UtcMs(D0),
                )
                .unwrap();
        }

        fn use_mail(&self, from: i64, to: i64) {
            self.store.seed_segment(Segment {
                id: SegmentId(0),
                started_at: UtcMs(D0 + from),
                ended_at: Some(UtcMs(D0 + to)),
                heartbeat_at: UtcMs(D0 + to),
                app_id: Some("mail".into()),
                app_name: Some("Mail".into()),
                window_title: None,
                end_reason: Some(EndReason::FocusChange),
                source: SegmentSource::Tracked,
                activity_id: None,
            });
        }

        fn step(&self, tracking: bool, at: i64) -> Duration {
            let events = self.events.clone();
            step(
                &self.goals,
                tracking,
                UtcMs(D0 + at),
                &self.notifier,
                &move |e| events.lock().unwrap().push(e),
            )
            .unwrap()
        }
    }

    #[test]
    fn it_wakes_when_the_nearest_threshold_would_be_crossed() {
        let r = rig();
        r.add(GoalKind::Maximum, HOUR);
        r.use_mail(9 * HOUR, 9 * HOUR + 50 * MIN);
        let wake = r.step(true, 10 * HOUR);
        // 10 minutes (plus the millisecond that makes it "over") and the slack.
        assert_eq!(
            wake,
            Duration::from_millis((10 * MIN + 1 + SLACK_MS) as u64)
        );
        assert!(r.events.lock().unwrap().is_empty());
    }

    #[test]
    fn without_tracking_it_only_waits_for_midnight() {
        let r = rig();
        r.add(GoalKind::Maximum, HOUR);
        r.use_mail(9 * HOUR, 9 * HOUR + 50 * MIN);
        let wake = r.step(false, 10 * HOUR);
        assert_eq!(wake, Duration::from_millis((14 * HOUR + SLACK_MS) as u64));
    }

    #[test]
    fn a_crossing_is_announced_once_with_a_notification_and_an_event() {
        let r = rig();
        r.add(GoalKind::Maximum, HOUR);
        r.use_mail(9 * HOUR, 11 * HOUR);
        r.step(true, 12 * HOUR);
        r.step(true, 13 * HOUR);
        let events = r.events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, GoalEventKindDto::Exceeded);
        assert_eq!(events[0].label, "Email");
        let alerts = r.notifier.goal_alerts.lock().unwrap();
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].0, "Email");
    }

    #[test]
    fn the_wake_up_never_lands_after_the_next_midnight() {
        let r = rig();
        r.add(GoalKind::Minimum, 20 * HOUR);
        // 20 hours away but only 1 hour to midnight: the day rolls over first.
        let wake = r.step(true, 23 * HOUR);
        assert_eq!(wake, Duration::from_millis((HOUR + SLACK_MS) as u64));
    }

    #[test]
    fn without_goals_it_still_wakes_at_midnight_to_stay_cheap() {
        let r = rig();
        let wake = r.step(true, 6 * HOUR);
        assert_eq!(wake, Duration::from_millis((18 * HOUR + SLACK_MS) as u64));
    }
}
