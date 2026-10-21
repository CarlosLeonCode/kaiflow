//! Focus sessions use cases: start, pause, observe, end, recover, and the pomodoro cycle.
//!
//! The pure machine (`domain::focus_session`) decides when a block ends and when a drift alert
//! is due; the pure cycle (`domain::focus_cycle`) decides what comes next. This service feeds
//! them what the user is looking at, stores the block and the cycle, and derives the end
//! summary from the tracked segments. One mutex owns the machine and the cycle, so the
//! commands and the focus watcher never race. A block is independent of tracking: it keeps
//! counting down while tracking is paused, but then nothing is observed and the drift rule is
//! suspended.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use domain::focus_cycle::{CardAction, Cycle, EndCard, Step};
use domain::focus_session::{
    Config, Effect, Event, FocusMachine, Persisted, Span, summarize, validate,
};
use domain::{
    Activity, ActivityId, FocusAllowed, FocusApp, FocusEnd, FocusError, FocusKind, FocusSnapshot,
    FocusSummary, Segment, SegmentId, SegmentSource, UtcMs,
};

use crate::dashboard::resolve;
use crate::ports::{
    ActivityRepository, DegradedReason, FocusEndAlert, FocusRepository, NewFocus, PortError,
    ReportRepository, RunningFocus, SettingsRepository, StoredFocus,
};
use crate::settings_blobs::{
    FocusTimerSettings, KEY_FOCUS_CYCLE, KEY_FOCUS_TIMER, read_blob, read_focus_drift_after_secs,
    write_blob,
};

/// Longest snooze a user can ask for.
const MAX_SNOOZE_MINUTES: u32 = 240;
/// Longest "more time" from the end card.
const MAX_MORE_MINUTES: u32 = 60;
/// Sessions listed in the history.
pub const HISTORY_LIMIT: u32 = 50;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FocusServiceError {
    Invalid(FocusError),
    /// Tracking is degraded, so what the user looks at cannot be observed: no drift detection.
    Unavailable(DegradedReason),
    Storage(PortError),
}

impl From<FocusError> for FocusServiceError {
    fn from(e: FocusError) -> Self {
        Self::Invalid(e)
    }
}

impl From<PortError> for FocusServiceError {
    fn from(e: PortError) -> Self {
        Self::Storage(e)
    }
}

impl std::fmt::Display for FocusServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(e) => e.fmt(f),
            Self::Unavailable(reason) => write!(f, "focus sessions are unavailable: {reason:?}"),
            Self::Storage(e) => e.fmt(f),
        }
    }
}

impl std::error::Error for FocusServiceError {}

/// What the user asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartRequest {
    pub kind: FocusKind,
    pub intent: String,
    pub planned_ms: i64,
    pub allowed: FocusAllowed,
}

/// The running block as the UI shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveSession {
    pub id: i64,
    pub kind: FocusKind,
    pub intent: String,
    pub started_at: UtcMs,
    pub planned_end: UtcMs,
    /// Set while paused; the countdown is frozen at `planned_end - paused_at`.
    pub paused_at: Option<UtcMs>,
    /// Planned length without the pauses (for the progress ring).
    pub planned_ms: i64,
    pub allowed: FocusAllowed,
    pub drift_alerts: u32,
    /// The app in front, when one is observed.
    pub current: Option<FocusApp>,
    /// The app an unacknowledged drift alert is about.
    pub alerting: Option<FocusApp>,
}

/// Where the pomodoro cycle stands, for the round dots.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CycleView {
    pub enabled: bool,
    /// Work blocks completed in this cycle.
    pub round: u32,
    /// Work blocks per cycle (a long break after them).
    pub every: u32,
}

/// The running block (if any), the summary and the end card waiting for the user (if any).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusState {
    pub active: Option<ActiveSession>,
    pub unseen: Option<StoredFocus>,
    pub card: Option<EndCard>,
    pub cycle: CycleView,
}

/// What changed after feeding the machine; the watcher announces it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Outcome {
    /// A drift alert is due: `(intent, app)`.
    pub alert: Option<(String, FocusApp)>,
    /// The session ended.
    pub finished: Option<StoredFocus>,
    /// The block ran its course: what to tell the user.
    pub ended: Option<FocusEndAlert>,
    /// A minute is left: `(kind, intent)`.
    pub heads_up: Option<(FocusKind, String)>,
    /// Anything the UI shows changed (alert raised or cleared, plan updated, session ended).
    pub changed: bool,
}

/// What the tray shows while a block runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraySession {
    pub kind: FocusKind,
    pub intent: String,
    pub remaining_ms: i64,
    pub paused: bool,
    pub drifting: bool,
}

struct Inner {
    machine: FocusMachine,
    /// Id of the stored row of the running session.
    id: Option<i64>,
    cycle: Cycle,
    timer: FocusTimerSettings,
}

pub struct FocusService {
    focus: Arc<dyn FocusRepository>,
    reports: Arc<dyn ReportRepository>,
    activities: Arc<dyn ActivityRepository>,
    settings: Arc<dyn SettingsRepository>,
    inner: Mutex<Inner>,
}

impl FocusService {
    pub fn new(
        focus: Arc<dyn FocusRepository>,
        reports: Arc<dyn ReportRepository>,
        activities: Arc<dyn ActivityRepository>,
        settings: Arc<dyn SettingsRepository>,
    ) -> Self {
        Self {
            focus,
            reports,
            activities,
            settings,
            inner: Mutex::new(Inner {
                machine: FocusMachine::new(Config::default()),
                id: None,
                cycle: Cycle::default(),
                timer: FocusTimerSettings::default(),
            }),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Reads the drift threshold and the timer settings (also after the user changes them).
    /// A corrupt timer blob falls back to the defaults rather than disabling focus blocks.
    pub fn refresh_config(&self) -> Result<(), FocusServiceError> {
        let secs = read_focus_drift_after_secs(self.settings.as_ref())?;
        let timer: FocusTimerSettings =
            read_blob(self.settings.as_ref(), KEY_FOCUS_TIMER).unwrap_or_default();
        let mut inner = self.lock();
        inner.machine.set_config(Config {
            drift_after_ms: i64::from(secs) * 1_000,
            heads_up: timer.heads_up,
        });
        inner.timer = timer;
        Ok(())
    }

    /// The timer settings in effect (sound, auto-start...).
    pub fn timer_settings(&self) -> FocusTimerSettings {
        self.lock().timer.clone()
    }

    fn load_cycle(&self) -> Cycle {
        read_blob::<stored::Cycle>(self.settings.as_ref(), KEY_FOCUS_CYCLE)
            .map(Into::into)
            .unwrap_or_default()
    }

    /// Best effort: losing the cycle state only resets the round dots.
    fn save_cycle(&self, cycle: &Cycle) {
        let _ = write_blob(
            self.settings.as_ref(),
            KEY_FOCUS_CYCLE,
            &stored::Cycle::from(cycle),
        );
    }

    /// Resumes a block left running (or paused) by a previous run of the app, or closes it as
    /// `Recovered` when its planned end already passed (its summary covers the time up to
    /// that end). Also picks up the stored cycle. Call once at startup.
    pub fn recover(
        &self,
        current: Option<&FocusSnapshot>,
        now: UtcMs,
    ) -> Result<Outcome, FocusServiceError> {
        self.refresh_config()?;
        let cycle = self.load_cycle();
        self.lock().cycle = cycle;
        let Some(stored) = self.focus.running()? else {
            return Ok(Outcome::default());
        };
        if stored.paused_at.is_none() && now >= stored.planned_end {
            let finished = self.close(&stored, stored.planned_end, FocusEnd::Recovered, now)?;
            let mut inner = self.lock();
            inner.cycle.cancelled(stored.planned_end);
            self.save_cycle(&inner.cycle);
            return Ok(Outcome {
                finished: Some(finished),
                changed: true,
                ..Outcome::default()
            });
        }
        let app = self.app_of(current, now)?;
        let mut inner = self.lock();
        inner.machine.restore(
            Persisted {
                kind: stored.kind,
                intent: stored.intent,
                started_at: stored.started_at,
                planned_end: stored.planned_end,
                allowed: stored.allowed,
                drift_alerts: stored.drift_alerts,
                paused_at: stored.paused_at,
                paused_ms: stored.paused_ms,
            },
            app,
            now,
        );
        inner.id = Some(stored.id);
        Ok(Outcome {
            changed: true,
            ..Outcome::default()
        })
    }

    /// Forgets the in-memory session and picks up whatever is stored (after a restore).
    pub fn reload(
        &self,
        current: Option<&FocusSnapshot>,
        now: UtcMs,
    ) -> Result<Outcome, FocusServiceError> {
        {
            let mut inner = self.lock();
            inner.machine.discard();
            inner.id = None;
        }
        self.recover(current, now)
    }

    pub fn status(&self, now: UtcMs) -> Result<FocusState, FocusServiceError> {
        let active = self.active(now);
        let unseen = self.focus.unseen()?;
        let inner = self.lock();
        let config = inner.timer.cycle();
        Ok(FocusState {
            active,
            unseen,
            card: inner.cycle.card.clone(),
            cycle: CycleView {
                enabled: config.enabled,
                round: inner.cycle.round.min(config.long_every),
                every: config.long_every,
            },
        })
    }

    fn active(&self, now: UtcMs) -> Option<ActiveSession> {
        let inner = self.lock();
        let (view, id) = (inner.machine.session()?, inner.id?);
        Some(ActiveSession {
            id,
            kind: view.kind(),
            intent: view.intent().to_owned(),
            started_at: view.started_at(),
            planned_end: view.planned_end(),
            paused_at: view.paused_at(),
            planned_ms: view.planned_ms(now),
            allowed: view.allowed().clone(),
            drift_alerts: view.drift_alerts(),
            current: view.current().cloned(),
            alerting: view.alerting().cloned(),
        })
    }

    /// Starts a block. `blocked` is why tracking is degraded (`None` when it is not):
    /// without window observation there is no drift detection, so no focus block starts (a
    /// timer or a break needs no observation and always can).
    pub fn start(
        &self,
        request: StartRequest,
        blocked: Option<DegradedReason>,
        current: Option<&FocusSnapshot>,
        now: UtcMs,
    ) -> Result<ActiveSession, FocusServiceError> {
        if request.kind == FocusKind::Focus
            && let Some(reason) = blocked
        {
            return Err(FocusServiceError::Unavailable(reason));
        }
        self.refresh_config()?;
        let intent = validate(
            request.kind,
            &request.intent,
            request.planned_ms,
            &request.allowed,
        )?;
        let step = Step {
            kind: request.kind,
            planned_ms: request.planned_ms,
            intent,
            allowed: request.allowed,
            long_break: false,
        };
        self.begin(step, current, now, true)
    }

    /// Starts `step`; `fresh` when the user asked for it (the cycle then records it).
    fn begin(
        &self,
        step: Step,
        current: Option<&FocusSnapshot>,
        now: UtcMs,
        fresh: bool,
    ) -> Result<ActiveSession, FocusServiceError> {
        let app = if step.kind == FocusKind::Focus {
            self.app_of(current, now)?
        } else {
            None
        };
        {
            let mut inner = self.lock();
            // Checked here too so a second start never reaches the store.
            inner.machine.handle(Event::Start {
                kind: step.kind,
                intent: step.intent.clone(),
                planned_ms: step.planned_ms,
                allowed: step.allowed.clone(),
                now,
                current: app,
            })?;
            let Some(saved) = inner.machine.session().map(|v| v.persisted()) else {
                return Err(FocusError::NotActive.into());
            };
            let inserted = self.focus.insert(&NewFocus {
                kind: saved.kind,
                intent: &saved.intent,
                started_at: saved.started_at,
                planned_end: saved.planned_end,
                allowed: &saved.allowed,
            });
            match inserted {
                Ok(id) => inner.id = Some(id),
                Err(e) => {
                    inner.machine.discard();
                    return Err(e.into());
                }
            }
            if fresh {
                inner.cycle.started(step, now);
            }
            self.save_cycle(&inner.cycle);
        }
        self.active(now).ok_or(FocusError::NotActive.into())
    }

    /// What the user looks at changed (or nothing can be observed: `None`).
    pub fn observe(
        &self,
        current: Option<&FocusSnapshot>,
        now: UtcMs,
    ) -> Result<Outcome, FocusServiceError> {
        if !self.lock().machine.is_active() {
            return Ok(Outcome::default());
        }
        let app = self.app_of(current, now)?;
        self.apply(Event::FocusChanged { app, now }, now)
    }

    /// Time passed: finishes the session or raises a due alert.
    pub fn tick(&self, now: UtcMs) -> Result<Outcome, FocusServiceError> {
        if !self.lock().machine.is_active() {
            return Ok(Outcome::default());
        }
        self.apply(Event::Tick { now }, now)
    }

    /// Adds `minutes` to the running session.
    pub fn extend(&self, minutes: u32, now: UtcMs) -> Result<Outcome, FocusServiceError> {
        self.apply(
            Event::Extend {
                by_ms: i64::from(minutes) * 60_000,
                now,
            },
            now,
        )
    }

    /// Freezes the countdown (and the drift rule) until [`Self::resume`].
    pub fn pause(&self, now: UtcMs) -> Result<Outcome, FocusServiceError> {
        self.apply(Event::Pause { now }, now)
    }

    /// Continues a paused block with the time it had left.
    pub fn resume(&self, now: UtcMs) -> Result<Outcome, FocusServiceError> {
        self.apply(Event::Resume { now }, now)
    }

    /// Ends the session now; returns it with its summary.
    pub fn stop(&self, now: UtcMs) -> Result<StoredFocus, FocusServiceError> {
        let outcome = self.apply(Event::Cancel { now }, now)?;
        outcome.finished.ok_or_else(|| FocusError::NotActive.into())
    }

    /// Answers the end card: start what comes next, skip it, or a few more minutes of the
    /// block that ended. Returns the block it started, if any. Without a card it does nothing.
    pub fn answer_card(
        &self,
        action: CardAction,
        current: Option<&FocusSnapshot>,
        now: UtcMs,
    ) -> Result<Option<ActiveSession>, FocusServiceError> {
        let action = match action {
            CardAction::MoreTime { ms } => CardAction::MoreTime {
                ms: ms.clamp(60_000, i64::from(MAX_MORE_MINUTES) * 60_000),
            },
            other => other,
        };
        let step = {
            let mut inner = self.lock();
            if inner.machine.is_active() {
                return Err(FocusError::AlreadyActive.into());
            }
            let step = inner.cycle.answer(action, now);
            self.save_cycle(&inner.cycle);
            step
        };
        step.map(|step| self.begin(step, current, now, false))
            .transpose()
    }

    /// "Back to it": acknowledges the alert and holds the next one back for `minutes`.
    pub fn snooze(&self, minutes: u32, now: UtcMs) -> Result<Outcome, FocusServiceError> {
        let minutes = minutes.clamp(1, MAX_SNOOZE_MINUTES);
        self.apply(
            Event::Snooze {
                until: now.plus_ms(i64::from(minutes) * 60_000),
                now,
            },
            now,
        )
    }

    /// "Allow this app" for the rest of the session.
    pub fn allow_app(&self, app_id: &str, now: UtcMs) -> Result<Outcome, FocusServiceError> {
        let app_id = app_id.trim();
        if app_id.is_empty() {
            return Err(FocusServiceError::Storage(PortError(
                "app id must not be empty".into(),
            )));
        }
        self.apply(
            Event::Allow {
                app_id: app_id.to_owned(),
                now,
            },
            now,
        )
    }

    /// The user acknowledged the end summary of a session.
    pub fn dismiss_summary(&self, id: i64) -> Result<(), FocusServiceError> {
        Ok(self.focus.mark_seen(id)?)
    }

    pub fn history(&self) -> Result<Vec<StoredFocus>, FocusServiceError> {
        Ok(self.focus.recent(HISTORY_LIMIT)?)
    }

    /// The next instant `tick` has something to do.
    pub fn next_deadline(&self) -> Option<UtcMs> {
        self.lock().machine.next_deadline()
    }

    pub fn tray(&self, now: UtcMs) -> Option<TraySession> {
        let inner = self.lock();
        let view = inner.machine.session()?;
        Some(TraySession {
            kind: view.kind(),
            intent: view.intent().to_owned(),
            remaining_ms: view.remaining_ms(now),
            paused: view.paused_at().is_some(),
            drifting: view.alerting().is_some(),
        })
    }

    /// Feeds one event to the machine and stores what it decided.
    fn apply(&self, event: Event, now: UtcMs) -> Result<Outcome, FocusServiceError> {
        let (effects, before, planned_ms, id) = {
            let mut inner = self.lock();
            let before = inner
                .machine
                .session()
                .map(|v| (v.persisted(), v.planned_ms(now)));
            let effects = inner.machine.handle(event)?;
            (
                effects,
                before.as_ref().map(|b| b.0.clone()),
                before.map(|b| b.1),
                inner.id,
            )
        };
        let (Some(before), Some(planned_ms), Some(id)) = (before, planned_ms, id) else {
            return Err(FocusError::NotActive.into());
        };
        let mut outcome = Outcome::default();
        for effect in effects {
            match effect {
                Effect::Started => {}
                Effect::Updated => {
                    outcome.changed = true;
                    let saved = self.lock().machine.session().map(|v| v.persisted());
                    if let Some(saved) = saved {
                        self.focus.update_running(
                            id,
                            &RunningFocus {
                                planned_end: saved.planned_end,
                                paused_at: saved.paused_at,
                                paused_ms: saved.paused_ms,
                                allowed: &saved.allowed,
                                drift_alerts: saved.drift_alerts,
                            },
                        )?;
                    }
                }
                Effect::DriftAlert(app) => {
                    outcome.changed = true;
                    outcome.alert = Some((before.intent.clone(), app));
                }
                Effect::DriftCleared => outcome.changed = true,
                Effect::HeadsUp => outcome.heads_up = Some((before.kind, before.intent.clone())),
                Effect::Finished { reason, at } => {
                    outcome.changed = true;
                    // The alert count may have grown in this very event.
                    let stored = StoredFocus {
                        id,
                        kind: before.kind,
                        intent: before.intent.clone(),
                        started_at: before.started_at,
                        planned_end: before.planned_end,
                        paused_at: None,
                        paused_ms: before.paused_ms,
                        ended_at: None,
                        end_reason: None,
                        drift_alerts: before.drift_alerts,
                        allowed: before.allowed.clone(),
                        summary: FocusSummary::default(),
                        seen: false,
                    };
                    outcome.finished = Some(self.close(&stored, at, reason, now)?);
                    self.lock().id = None;
                    if reason == FocusEnd::Completed {
                        outcome.ended = Some(self.completed(&before, planned_ms, at, now));
                    } else {
                        let mut inner = self.lock();
                        inner.cycle.cancelled(at);
                        self.save_cycle(&inner.cycle);
                    }
                }
            }
        }
        Ok(outcome)
    }

    /// A block ran its course: moves the cycle on, starts what comes next when auto-start is
    /// on, and says what to tell the user.
    fn completed(
        &self,
        before: &Persisted,
        planned_ms: i64,
        at: UtcMs,
        now: UtcMs,
    ) -> FocusEndAlert {
        let (next, auto, sound) = {
            let mut inner = self.lock();
            let config = inner.timer.cycle();
            let long_break = inner.cycle.long_break_running;
            let finished = Step {
                kind: before.kind,
                planned_ms,
                intent: before.intent.clone(),
                allowed: before.allowed.clone(),
                long_break: before.kind == FocusKind::Break && long_break,
            };
            let next = inner
                .cycle
                .completed(finished, at, &config)
                .next
                .as_ref()
                .map(|n| (n.kind, n.planned_ms));
            let auto = if inner.timer.auto_start_next {
                inner.cycle.auto_start(now)
            } else {
                None
            };
            self.save_cycle(&inner.cycle);
            (next, auto, inner.timer.sound)
        };
        // The next block needs no observation to start; the watcher feeds it right after.
        let auto_started = auto.is_some_and(|step| self.begin(step, None, now, false).is_ok());
        FocusEndAlert {
            kind: before.kind,
            intent: before.intent.clone(),
            next,
            auto_started,
            sound,
        }
    }

    /// Computes the summary of `[started_at, at)` and stores the closed session. Only a focus
    /// block has a summary to look at; timers and breaks are acknowledged right away.
    fn close(
        &self,
        stored: &StoredFocus,
        at: UtcMs,
        reason: FocusEnd,
        now: UtcMs,
    ) -> Result<StoredFocus, FocusServiceError> {
        let with_summary = stored.kind == FocusKind::Focus;
        let summary = if with_summary {
            self.summary(stored, at, now)?
        } else {
            FocusSummary::default()
        };
        self.focus.close(stored.id, at, reason, &summary)?;
        if !with_summary {
            self.focus.mark_seen(stored.id)?;
        }
        Ok(StoredFocus {
            ended_at: Some(at),
            end_reason: Some(reason),
            paused_at: None,
            summary,
            seen: !with_summary,
            ..stored.clone()
        })
    }

    /// Tracked time of the session split into inside and outside, from the segments.
    fn summary(
        &self,
        stored: &StoredFocus,
        at: UtcMs,
        now: UtcMs,
    ) -> Result<FocusSummary, FocusServiceError> {
        let rules = self.activities.list_rules()?;
        let activities = self.activities.list()?;
        let known: HashMap<ActivityId, &Activity> = activities.iter().map(|a| (a.id, a)).collect();
        let segments = self.reports.segments_in_range(stored.started_at, at)?;
        let mut memo = HashMap::new();
        let spans: Vec<Span> = segments
            .iter()
            .filter_map(|segment| {
                let start = segment.started_at.max(stored.started_at);
                let end = segment.ended_at.unwrap_or(now).min(at);
                (end > start).then(|| Span {
                    app_id: segment.app_id.clone().unwrap_or_default(),
                    app_name: segment
                        .app_name
                        .clone()
                        .or_else(|| segment.app_id.clone())
                        .unwrap_or_else(|| "Assigned time".into()),
                    activity: resolve(segment, &rules, &known, &mut memo),
                    start,
                    end,
                })
            })
            .collect();
        Ok(summarize(&spans, &stored.allowed))
    }

    /// The app in front with the activity the rules file it under.
    fn app_of(
        &self,
        current: Option<&FocusSnapshot>,
        now: UtcMs,
    ) -> Result<Option<FocusApp>, FocusServiceError> {
        let Some(focus) = current else {
            return Ok(None);
        };
        let rules = self.activities.list_rules()?;
        let activities = self.activities.list()?;
        let known: HashMap<ActivityId, &Activity> = activities.iter().map(|a| (a.id, a)).collect();
        let probe = Segment {
            id: SegmentId(0),
            started_at: now,
            ended_at: None,
            heartbeat_at: now,
            app_id: Some(focus.app_id.clone()),
            app_name: Some(focus.app_name.clone()),
            window_title: focus.window_title.clone(),
            end_reason: None,
            source: SegmentSource::Tracked,
            activity_id: None,
        };
        let activity = resolve(&probe, &rules, &known, &mut HashMap::new());
        Ok(Some(FocusApp {
            app_id: focus.app_id.clone(),
            app_name: focus.app_name.clone(),
            activity,
        }))
    }
}

/// The cycle as stored in the `focus_cycle` settings blob (the domain stays serde-free).
mod stored {
    use domain::focus_cycle::{self, EndCard};
    use domain::{ActivityId, FocusAllowed, FocusKind, UtcMs};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Default, Serialize, Deserialize)]
    #[serde(default)]
    pub struct Step {
        kind: String,
        planned_ms: i64,
        intent: String,
        activities: Vec<i64>,
        apps: Vec<String>,
        long_break: bool,
    }

    #[derive(Debug, Clone, Default, Serialize, Deserialize)]
    #[serde(default)]
    pub struct Card {
        finished: Step,
        at: i64,
        next: Option<Step>,
    }

    #[derive(Debug, Clone, Default, Serialize, Deserialize)]
    #[serde(default)]
    pub struct Cycle {
        round: u32,
        last_work: Option<Step>,
        last_end_at: Option<i64>,
        card: Option<Card>,
        continuing: bool,
        deferred: Option<Step>,
        long_break_running: bool,
    }

    impl From<&focus_cycle::Step> for Step {
        fn from(s: &focus_cycle::Step) -> Self {
            Self {
                kind: s.kind.as_str().to_owned(),
                planned_ms: s.planned_ms,
                intent: s.intent.clone(),
                activities: s.allowed.activities.iter().map(|a| a.0).collect(),
                apps: s.allowed.apps.clone(),
                long_break: s.long_break,
            }
        }
    }

    impl From<Step> for focus_cycle::Step {
        fn from(s: Step) -> Self {
            Self {
                kind: FocusKind::parse(&s.kind).unwrap_or(FocusKind::Timer),
                planned_ms: s.planned_ms,
                intent: s.intent,
                allowed: FocusAllowed {
                    activities: s.activities.into_iter().map(ActivityId).collect(),
                    apps: s.apps,
                },
                long_break: s.long_break,
            }
        }
    }

    impl From<&focus_cycle::Cycle> for Cycle {
        fn from(c: &focus_cycle::Cycle) -> Self {
            Self {
                round: c.round,
                last_work: c.last_work.as_ref().map(Into::into),
                last_end_at: c.last_end_at.map(|t| t.0),
                card: c.card.as_ref().map(|card| Card {
                    finished: (&card.finished).into(),
                    at: card.at.0,
                    next: card.next.as_ref().map(Into::into),
                }),
                continuing: c.continuing,
                deferred: c.deferred.as_ref().map(Into::into),
                long_break_running: c.long_break_running,
            }
        }
    }

    impl From<Cycle> for focus_cycle::Cycle {
        fn from(c: Cycle) -> Self {
            Self {
                round: c.round,
                last_work: c.last_work.map(Into::into),
                last_end_at: c.last_end_at.map(UtcMs),
                card: c.card.map(|card| EndCard {
                    finished: card.finished.into(),
                    at: UtcMs(card.at),
                    next: card.next.map(Into::into),
                }),
                continuing: c.continuing,
                deferred: c.deferred.map(Into::into),
                long_break_running: c.long_break_running,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use domain::{ActivityRule, EndReason, Productivity, RuleKind};

    use super::*;
    use crate::fakes::{FakeActivities, FakeFocus, FakeSettings, FakeStore};

    const S: i64 = 1_000;
    const MIN: i64 = 60 * S;
    const T0: i64 = 1_000_000_000;

    struct Rig {
        service: FocusService,
        store: FakeStore,
        focus: FakeFocus,
        settings: FakeSettings,
        work: ActivityId,
    }

    fn rig() -> Rig {
        let store = FakeStore::default();
        let focus = FakeFocus::default();
        let settings = FakeSettings::default();
        let activities = FakeActivities::default();
        // The fake store has no system activity: take id 1 so "Work" is a different one.
        activities
            .create("Unassigned", "#999", Productivity::Neutral)
            .unwrap();
        let work = activities
            .create("Work", "#111", Productivity::Productive)
            .unwrap()
            .id;
        let service = FocusService::new(
            Arc::new(focus.clone()),
            Arc::new(store.clone()),
            Arc::new(activities.clone()),
            Arc::new(settings.clone()),
        );
        // The code editor belongs to Work by rule.
        activities
            .save_rule(&ActivityRule {
                id: 0,
                activity_id: work,
                kind: RuleKind::App("code".into()),
                priority: 0,
            })
            .unwrap();
        Rig {
            service,
            store,
            focus,
            settings,
            work,
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

    fn spend(store: &FakeStore, id: &str, start: i64, end: i64) {
        store.seed_segment(Segment {
            id: SegmentId(0),
            started_at: UtcMs(start),
            ended_at: Some(UtcMs(end)),
            heartbeat_at: UtcMs(end),
            app_id: Some(id.into()),
            app_name: Some(id.to_uppercase()),
            window_title: None,
            end_reason: Some(EndReason::FocusChange),
            source: SegmentSource::Tracked,
            activity_id: None,
        });
    }

    fn request(rig: &Rig) -> StartRequest {
        StartRequest {
            kind: FocusKind::Focus,
            intent: "Write report".into(),
            planned_ms: 50 * MIN,
            allowed: FocusAllowed {
                activities: vec![rig.work],
                apps: vec!["excel".into()],
            },
        }
    }

    fn start(rig: &Rig, current: Option<&FocusSnapshot>) -> ActiveSession {
        rig.service
            .start(request(rig), None, current, UtcMs(T0))
            .unwrap()
    }

    #[test]
    fn a_session_is_stored_and_reported() {
        let r = rig();
        let active = start(&r, Some(&app("code")));
        assert_eq!(active.intent, "Write report");
        assert_eq!(active.planned_end, UtcMs(T0 + 50 * MIN));
        assert_eq!(active.current.as_ref().unwrap().activity, r.work);
        assert_eq!(r.focus.all().len(), 1);
        let state = r.service.status(UtcMs(T0)).unwrap();
        assert_eq!(state.active, Some(active));
        assert!(state.unseen.is_none());
        let tray = r.service.tray(UtcMs(T0 + 27 * MIN)).unwrap();
        assert_eq!(
            (tray.intent.as_str(), tray.remaining_ms, tray.drifting),
            ("Write report", 23 * MIN, false)
        );
    }

    #[test]
    fn every_degraded_reason_blocks_a_new_session_and_stores_nothing() {
        for reason in [
            DegradedReason::AccessibilityDenied,
            DegradedReason::WaylandSession,
            DegradedReason::NoDisplay,
        ] {
            let r = rig();
            let out = r.service.start(request(&r), Some(reason), None, UtcMs(T0));
            assert_eq!(out, Err(FocusServiceError::Unavailable(reason)));
            assert!(r.focus.all().is_empty());
            assert!(r.service.status(UtcMs(T0)).unwrap().active.is_none());
        }
    }

    #[test]
    fn invalid_requests_and_a_second_session_are_rejected() {
        let r = rig();
        let mut nothing = request(&r);
        nothing.allowed = FocusAllowed::default();
        assert_eq!(
            r.service.start(nothing, None, None, UtcMs(T0)),
            Err(FocusServiceError::Invalid(FocusError::NothingAllowed))
        );
        start(&r, None);
        assert_eq!(
            r.service.start(request(&r), None, None, UtcMs(T0 + 1)),
            Err(FocusServiceError::Invalid(FocusError::AlreadyActive))
        );
        assert_eq!(r.focus.all().len(), 1);
    }

    #[test]
    fn a_drift_raises_one_alert_and_it_is_counted_and_stored() {
        let r = rig();
        start(&r, Some(&app("excel")));
        let out = r
            .service
            .observe(Some(&app("slack")), UtcMs(T0 + 10 * S))
            .unwrap();
        assert_eq!(out, Outcome::default());
        assert_eq!(r.service.next_deadline(), Some(UtcMs(T0 + 100 * S)));
        assert_eq!(
            r.service.tick(UtcMs(T0 + 99 * S)).unwrap(),
            Outcome::default()
        );
        let out = r.service.tick(UtcMs(T0 + 101 * S)).unwrap();
        let (intent, alert) = out.alert.unwrap();
        assert_eq!(
            (intent.as_str(), alert.app_id.as_str()),
            ("Write report", "slack")
        );
        assert!(out.changed);
        assert_eq!(r.focus.all()[0].drift_alerts, 1);
        let state = r.service.status(UtcMs(T0 + 102 * S)).unwrap();
        assert_eq!(state.active.unwrap().alerting.unwrap().app_id, "slack");
        assert!(r.service.tray(UtcMs(T0 + 102 * S)).unwrap().drifting);
    }

    #[test]
    fn going_back_before_the_threshold_raises_nothing() {
        let r = rig();
        start(&r, Some(&app("excel")));
        r.service.observe(Some(&app("slack")), UtcMs(T0)).unwrap();
        r.service
            .observe(Some(&app("code")), UtcMs(T0 + 60 * S))
            .unwrap();
        assert_eq!(
            r.service.tick(UtcMs(T0 + 200 * S)).unwrap(),
            Outcome::default()
        );
        assert_eq!(r.focus.all()[0].drift_alerts, 0);
    }

    #[test]
    fn allowing_the_app_stores_the_new_allowed_set_and_clears_the_alert() {
        let r = rig();
        start(&r, None);
        r.service.observe(Some(&app("slack")), UtcMs(T0)).unwrap();
        r.service.tick(UtcMs(T0 + 91 * S)).unwrap();
        let out = r.service.allow_app("slack", UtcMs(T0 + 95 * S)).unwrap();
        assert!(out.changed);
        assert!(r.focus.all()[0].allowed.apps.contains(&"slack".to_owned()));
        let active = r
            .service
            .status(UtcMs(T0 + 96 * S))
            .unwrap()
            .active
            .unwrap();
        assert!(active.alerting.is_none());
    }

    #[test]
    fn back_to_it_snoozes_the_alert() {
        let r = rig();
        start(&r, None);
        r.service.observe(Some(&app("slack")), UtcMs(T0)).unwrap();
        r.service.tick(UtcMs(T0 + 91 * S)).unwrap();
        r.service.snooze(10, UtcMs(T0 + 95 * S)).unwrap();
        assert_eq!(r.service.tick(UtcMs(T0 + 9 * MIN)).unwrap().alert, None);
        assert!(
            r.service
                .tick(UtcMs(T0 + 12 * MIN))
                .unwrap()
                .alert
                .is_some()
        );
    }

    #[test]
    fn nothing_observed_suspends_detection() {
        let r = rig();
        start(&r, Some(&app("slack")));
        // Paused, idle, asleep: the watcher reports no focus.
        r.service.observe(None, UtcMs(T0 + 10 * S)).unwrap();
        assert_eq!(r.service.next_deadline(), Some(UtcMs(T0 + 50 * MIN)));
        assert_eq!(
            r.service.tick(UtcMs(T0 + 30 * MIN)).unwrap(),
            Outcome::default()
        );
    }

    #[test]
    fn the_planned_end_closes_the_session_with_a_summary_from_the_segments() {
        let r = rig();
        start(&r, Some(&app("excel")));
        spend(&r.store, "excel", T0, T0 + 30 * MIN);
        spend(&r.store, "code", T0 + 30 * MIN, T0 + 35 * MIN);
        spend(&r.store, "slack", T0 + 35 * MIN, T0 + 45 * MIN);
        spend(&r.store, "mail", T0 + 45 * MIN, T0 + 60 * MIN);
        let out = r.service.tick(UtcMs(T0 + 55 * MIN)).unwrap();
        let finished = out.finished.unwrap();
        assert_eq!(finished.end_reason, Some(FocusEnd::Completed));
        assert_eq!(finished.ended_at, Some(UtcMs(T0 + 50 * MIN)));
        // Mail is cut at the planned end: 5 of its 15 minutes fall inside the session.
        assert_eq!(
            (finished.summary.inside_ms, finished.summary.outside_ms),
            (35 * MIN, 15 * MIN)
        );
        assert_eq!(finished.summary.top_distractions[0].app_id, "slack");
        let stored = &r.focus.all()[0];
        assert_eq!(stored.summary, finished.summary);
        assert_eq!(stored.ended_at, Some(UtcMs(T0 + 50 * MIN)));
        let state = r.service.status(UtcMs(T0 + 56 * MIN)).unwrap();
        assert!(state.active.is_none());
        assert_eq!(state.unseen.unwrap().id, finished.id, "waits for the user");
        r.service.dismiss_summary(finished.id).unwrap();
        assert!(
            r.service
                .status(UtcMs(T0 + 57 * MIN))
                .unwrap()
                .unseen
                .is_none()
        );
        assert_eq!(r.service.history().unwrap().len(), 1);
    }

    #[test]
    fn ending_early_stores_what_was_tracked_so_far() {
        let r = rig();
        start(&r, None);
        spend(&r.store, "excel", T0, T0 + 10 * MIN);
        let done = r.service.stop(UtcMs(T0 + 12 * MIN)).unwrap();
        assert_eq!(done.end_reason, Some(FocusEnd::Cancelled));
        assert_eq!(done.summary.percent_inside(), Some(100));
        assert_eq!(
            r.service.stop(UtcMs(T0 + 13 * MIN)),
            Err(FocusError::NotActive.into())
        );
        // A new session can start straight away.
        assert!(
            r.service
                .start(request(&r), None, None, UtcMs(T0 + 14 * MIN))
                .is_ok()
        );
    }

    #[test]
    fn a_session_without_tracked_time_has_an_empty_summary() {
        let r = rig();
        start(&r, None);
        let done = r.service.stop(UtcMs(T0 + 5 * MIN)).unwrap();
        assert_eq!(done.summary.percent_inside(), None);
    }

    #[test]
    fn extending_stores_the_new_end() {
        let r = rig();
        start(&r, None);
        r.service.extend(10, UtcMs(T0 + 40 * MIN)).unwrap();
        assert_eq!(r.focus.all()[0].planned_end, UtcMs(T0 + 60 * MIN));
        assert!(r.service.extend(0, UtcMs(T0 + 41 * MIN)).is_err());
    }

    #[test]
    fn a_running_session_resumes_after_a_restart_with_the_right_time_left() {
        let r = rig();
        start(&r, None);
        // A fresh service over the same store: the app was restarted 20 minutes in.
        let again = FocusService::new(
            Arc::new(r.focus.clone()),
            Arc::new(r.store.clone()),
            Arc::new(FakeActivities::default()),
            Arc::new(r.settings.clone()),
        );
        let out = again
            .recover(Some(&app("slack")), UtcMs(T0 + 20 * MIN))
            .unwrap();
        assert!(out.finished.is_none());
        let active = again.status(UtcMs(T0 + 20 * MIN)).unwrap().active.unwrap();
        assert_eq!(active.planned_end, UtcMs(T0 + 50 * MIN));
        assert_eq!(
            again.tray(UtcMs(T0 + 20 * MIN)).unwrap().remaining_ms,
            30 * MIN
        );
        // The drift rule is live again, with fresh timers.
        assert_eq!(again.next_deadline(), Some(UtcMs(T0 + 20 * MIN + 90 * S)));
    }

    #[test]
    fn an_expired_session_is_closed_as_recovered_with_a_summary_up_to_its_end() {
        let r = rig();
        start(&r, None);
        spend(&r.store, "excel", T0, T0 + 20 * MIN);
        spend(&r.store, "slack", T0 + 20 * MIN, T0 + 80 * MIN);
        let again = FocusService::new(
            Arc::new(r.focus.clone()),
            Arc::new(r.store.clone()),
            Arc::new(FakeActivities::default()),
            Arc::new(r.settings.clone()),
        );
        let out = again.recover(None, UtcMs(T0 + 3 * 60 * MIN)).unwrap();
        let done = out.finished.unwrap();
        assert_eq!(done.end_reason, Some(FocusEnd::Recovered));
        assert_eq!(done.ended_at, Some(UtcMs(T0 + 50 * MIN)));
        assert_eq!(
            (done.summary.inside_ms, done.summary.outside_ms),
            (20 * MIN, 30 * MIN)
        );
        assert!(
            again
                .status(UtcMs(T0 + 3 * 60 * MIN))
                .unwrap()
                .active
                .is_none()
        );
        assert!(
            again
                .status(UtcMs(T0 + 3 * 60 * MIN))
                .unwrap()
                .unseen
                .is_some()
        );
        assert!(r.focus.running().unwrap().is_none());
    }

    fn timer(minutes: i64) -> StartRequest {
        StartRequest {
            kind: FocusKind::Timer,
            intent: String::new(),
            planned_ms: minutes * MIN,
            allowed: FocusAllowed::default(),
        }
    }

    fn restarted(r: &Rig) -> FocusService {
        FocusService::new(
            Arc::new(r.focus.clone()),
            Arc::new(r.store.clone()),
            Arc::new(FakeActivities::default()),
            Arc::new(r.settings.clone()),
        )
    }

    #[test]
    fn a_timer_runs_without_observation_even_when_tracking_is_degraded() {
        let r = rig();
        let active = r
            .service
            .start(
                timer(25),
                Some(DegradedReason::AccessibilityDenied),
                Some(&app("slack")),
                UtcMs(T0),
            )
            .unwrap();
        assert_eq!(
            (active.kind, active.intent.as_str()),
            (FocusKind::Timer, "")
        );
        assert!(active.current.is_none() && active.allowed.is_empty());
        assert_eq!(active.planned_ms, 25 * MIN);
        let out = r.service.tick(UtcMs(T0 + 25 * MIN)).unwrap();
        let done = out.finished.unwrap();
        assert!(done.seen, "a timer has no summary to dismiss");
        assert!(
            r.service
                .status(UtcMs(T0 + 26 * MIN))
                .unwrap()
                .unseen
                .is_none()
        );
        let ended = out.ended.unwrap();
        assert_eq!(ended.kind, FocusKind::Timer);
        assert_eq!(ended.next, Some((FocusKind::Break, 5 * MIN)));
        assert!(!ended.auto_started && ended.sound);
    }

    #[test]
    fn pause_and_resume_are_stored_and_keep_the_time_left() {
        let r = rig();
        r.service.start(timer(25), None, None, UtcMs(T0)).unwrap();
        r.service.pause(UtcMs(T0 + 10 * MIN)).unwrap();
        assert_eq!(r.focus.all()[0].paused_at, Some(UtcMs(T0 + 10 * MIN)));
        let tray = r.service.tray(UtcMs(T0 + 50 * MIN)).unwrap();
        assert!(tray.paused);
        assert_eq!(tray.remaining_ms, 15 * MIN);
        assert_eq!(r.service.next_deadline(), None);
        // Restarted while paused: still paused, with the same time left.
        let again = restarted(&r);
        again.recover(None, UtcMs(T0 + 90 * MIN)).unwrap();
        let active = again.status(UtcMs(T0 + 90 * MIN)).unwrap().active.unwrap();
        assert_eq!(active.paused_at, Some(UtcMs(T0 + 10 * MIN)));
        again.resume(UtcMs(T0 + 100 * MIN)).unwrap();
        let stored = &r.focus.all()[0];
        assert_eq!((stored.paused_at, stored.paused_ms), (None, 90 * MIN));
        assert_eq!(stored.planned_end, UtcMs(T0 + 115 * MIN));
        assert_eq!(
            again.tray(UtcMs(T0 + 100 * MIN)).unwrap().remaining_ms,
            15 * MIN
        );
        let done = again.tick(UtcMs(T0 + 115 * MIN)).unwrap().finished.unwrap();
        assert_eq!(done.worked_ms(), 25 * MIN);
    }

    #[test]
    fn the_end_card_offers_a_break_and_starting_it_runs_one() {
        let r = rig();
        r.service.start(timer(25), None, None, UtcMs(T0)).unwrap();
        r.service.tick(UtcMs(T0 + 25 * MIN)).unwrap();
        let state = r.service.status(UtcMs(T0 + 25 * MIN)).unwrap();
        let card = state.card.unwrap();
        assert_eq!(card.finished.kind, FocusKind::Timer);
        assert_eq!(card.next.as_ref().unwrap().planned_ms, 5 * MIN);
        assert_eq!((state.cycle.round, state.cycle.every), (1, 4));
        // The card and the round survive a restart.
        let again = restarted(&r);
        again.recover(None, UtcMs(T0 + 26 * MIN)).unwrap();
        assert!(again.status(UtcMs(T0 + 26 * MIN)).unwrap().card.is_some());
        let brk = again
            .answer_card(CardAction::StartNext, None, UtcMs(T0 + 26 * MIN))
            .unwrap()
            .unwrap();
        assert_eq!((brk.kind, brk.planned_ms), (FocusKind::Break, 5 * MIN));
        let state = again.status(UtcMs(T0 + 27 * MIN)).unwrap();
        assert!(state.card.is_none());
        assert_eq!(state.cycle.round, 1);
        // A card action while a block runs is refused.
        assert_eq!(
            again.answer_card(CardAction::Skip, None, UtcMs(T0 + 27 * MIN)),
            Err(FocusServiceError::Invalid(FocusError::AlreadyActive))
        );
        let ended = again.tick(UtcMs(T0 + 31 * MIN)).unwrap().ended.unwrap();
        assert_eq!(ended.next, Some((FocusKind::Timer, 25 * MIN)));
    }

    #[test]
    fn more_time_runs_the_same_block_again_and_keeps_the_offer() {
        let r = rig();
        r.service.start(request(&r), None, None, UtcMs(T0)).unwrap();
        r.service.tick(UtcMs(T0 + 50 * MIN)).unwrap();
        let more = r
            .service
            .answer_card(
                CardAction::MoreTime { ms: 5 * MIN },
                Some(&app("excel")),
                UtcMs(T0 + 51 * MIN),
            )
            .unwrap()
            .unwrap();
        assert_eq!((more.kind, more.planned_ms), (FocusKind::Focus, 5 * MIN));
        assert_eq!(more.intent, "Write report");
        assert_eq!(more.allowed, request(&r).allowed);
        let ended = r.service.tick(UtcMs(T0 + 56 * MIN)).unwrap().ended.unwrap();
        assert_eq!(ended.next, Some((FocusKind::Break, 5 * MIN)));
        assert_eq!(
            r.service.status(UtcMs(T0 + 56 * MIN)).unwrap().cycle.round,
            1
        );
        // Skip clears the card.
        r.service
            .answer_card(CardAction::Skip, None, UtcMs(T0 + 57 * MIN))
            .unwrap();
        assert!(
            r.service
                .status(UtcMs(T0 + 57 * MIN))
                .unwrap()
                .card
                .is_none()
        );
    }

    #[test]
    fn auto_start_starts_the_break_right_away() {
        let r = rig();
        r.settings
            .set(
                "focus_timer",
                r#"{"auto_start_next": true, "short_break_minutes": 3}"#,
            )
            .unwrap();
        r.service.start(timer(25), None, None, UtcMs(T0)).unwrap();
        let out = r.service.tick(UtcMs(T0 + 25 * MIN)).unwrap();
        assert!(out.ended.unwrap().auto_started);
        let state = r.service.status(UtcMs(T0 + 25 * MIN)).unwrap();
        assert!(state.card.is_none());
        let active = state.active.unwrap();
        assert_eq!(
            (active.kind, active.planned_ms),
            (FocusKind::Break, 3 * MIN)
        );
    }

    #[test]
    fn ending_early_shows_no_card() {
        let r = rig();
        r.service.start(timer(25), None, None, UtcMs(T0)).unwrap();
        r.service.stop(UtcMs(T0 + 5 * MIN)).unwrap();
        let state = r.service.status(UtcMs(T0 + 5 * MIN)).unwrap();
        assert!(state.card.is_none());
        assert_eq!(state.cycle.round, 0);
    }

    #[test]
    fn the_heads_up_follows_the_setting() {
        let r = rig();
        r.settings
            .set("focus_timer", r#"{"heads_up": true}"#)
            .unwrap();
        r.service.start(timer(25), None, None, UtcMs(T0)).unwrap();
        let out = r.service.tick(UtcMs(T0 + 24 * MIN)).unwrap();
        assert_eq!(out.heads_up, Some((FocusKind::Timer, String::new())));
    }

    #[test]
    fn the_drift_threshold_follows_the_setting() {
        let r = rig();
        r.settings.set("focus_drift_after_secs", "30").unwrap();
        start(&r, Some(&app("slack")));
        assert_eq!(r.service.next_deadline(), Some(UtcMs(T0 + 30 * S)));
    }

    #[test]
    fn a_failed_store_leaves_no_session_behind() {
        let r = rig();
        r.focus.seed(StoredFocus {
            id: 9,
            kind: FocusKind::Focus,
            intent: "other".into(),
            started_at: UtcMs(1),
            planned_end: UtcMs(2),
            paused_at: None,
            paused_ms: 0,
            ended_at: None,
            end_reason: None,
            drift_alerts: 0,
            allowed: FocusAllowed::default(),
            summary: FocusSummary::default(),
            seen: false,
        });
        // The store refuses a second running row; the machine must not keep one either.
        let out = r.service.start(request(&r), None, None, UtcMs(T0));
        assert!(matches!(out, Err(FocusServiceError::Storage(_))));
        assert!(r.service.status(UtcMs(T0)).unwrap().active.is_none());
    }
}
