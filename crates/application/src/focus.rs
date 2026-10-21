//! Focus sessions use cases: start, observe, end, recover.
//!
//! The pure machine (`domain::focus_session`) decides; this service feeds it what the user is
//! looking at, stores the session, and derives the end summary from the tracked segments. One
//! mutex owns the machine, so the commands and the focus watcher never race. The session is
//! independent of tracking: it keeps counting down while tracking is paused, but then nothing
//! is observed and the drift rule is suspended.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use domain::focus_session::{
    Config, Effect, Event, FocusMachine, Persisted, Span, summarize, validate,
};
use domain::{
    Activity, ActivityId, FocusAllowed, FocusApp, FocusEnd, FocusError, FocusSnapshot,
    FocusSummary, Segment, SegmentId, SegmentSource, UtcMs,
};

use crate::dashboard::resolve;
use crate::ports::{
    ActivityRepository, DegradedReason, FocusRepository, PortError, ReportRepository,
    SettingsRepository, StoredFocus,
};
use crate::settings_blobs::read_focus_drift_after_secs;

/// Longest snooze a user can ask for.
const MAX_SNOOZE_MINUTES: u32 = 240;
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
    pub intent: String,
    pub planned_ms: i64,
    pub allowed: FocusAllowed,
}

/// The running session as the UI shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveSession {
    pub id: i64,
    pub intent: String,
    pub started_at: UtcMs,
    pub planned_end: UtcMs,
    pub allowed: FocusAllowed,
    pub drift_alerts: u32,
    /// The app in front, when one is observed.
    pub current: Option<FocusApp>,
    /// The app an unacknowledged drift alert is about.
    pub alerting: Option<FocusApp>,
}

/// The running session (if any) and the summary waiting to be acknowledged (if any).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusState {
    pub active: Option<ActiveSession>,
    pub unseen: Option<StoredFocus>,
}

/// What changed after feeding the machine; the watcher announces it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Outcome {
    /// A drift alert is due: `(intent, app)`.
    pub alert: Option<(String, FocusApp)>,
    /// The session ended.
    pub finished: Option<StoredFocus>,
    /// Anything the UI shows changed (alert raised or cleared, plan updated, session ended).
    pub changed: bool,
}

/// What the tray shows while a session runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraySession {
    pub intent: String,
    pub remaining_ms: i64,
    pub drifting: bool,
}

struct Inner {
    machine: FocusMachine,
    /// Id of the stored row of the running session.
    id: Option<i64>,
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
            }),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Reads the drift threshold from the settings (also after the user changes it).
    pub fn refresh_config(&self) -> Result<(), FocusServiceError> {
        let secs = read_focus_drift_after_secs(self.settings.as_ref())?;
        self.lock().machine.set_config(Config {
            drift_after_ms: i64::from(secs) * 1_000,
        });
        Ok(())
    }

    /// Resumes a session left running by a previous run of the app, or closes it as
    /// `Recovered` when its planned end already passed (its summary covers the time up to
    /// that end). Call once at startup.
    pub fn recover(
        &self,
        current: Option<&FocusSnapshot>,
        now: UtcMs,
    ) -> Result<Outcome, FocusServiceError> {
        self.refresh_config()?;
        let Some(stored) = self.focus.running()? else {
            return Ok(Outcome::default());
        };
        if now >= stored.planned_end {
            let finished = self.close(&stored, stored.planned_end, FocusEnd::Recovered, now)?;
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
                intent: stored.intent,
                started_at: stored.started_at,
                planned_end: stored.planned_end,
                allowed: stored.allowed,
                drift_alerts: stored.drift_alerts,
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
        Ok(FocusState { active, unseen })
    }

    fn active(&self, _now: UtcMs) -> Option<ActiveSession> {
        let inner = self.lock();
        let (view, id) = (inner.machine.session()?, inner.id?);
        Some(ActiveSession {
            id,
            intent: view.intent().to_owned(),
            started_at: view.started_at(),
            planned_end: view.planned_end(),
            allowed: view.allowed().clone(),
            drift_alerts: view.drift_alerts(),
            current: view.current().cloned(),
            alerting: view.alerting().cloned(),
        })
    }

    /// Starts a session. `blocked` is why tracking is degraded (`None` when it is not):
    /// without window observation there is no drift detection, so no session starts.
    pub fn start(
        &self,
        request: StartRequest,
        blocked: Option<DegradedReason>,
        current: Option<&FocusSnapshot>,
        now: UtcMs,
    ) -> Result<ActiveSession, FocusServiceError> {
        if let Some(reason) = blocked {
            return Err(FocusServiceError::Unavailable(reason));
        }
        self.refresh_config()?;
        validate(&request.intent, request.planned_ms, &request.allowed)?;
        let app = self.app_of(current, now)?;
        {
            let mut inner = self.lock();
            // Checked here too so a second start never reaches the store.
            inner.machine.handle(Event::Start {
                intent: request.intent,
                planned_ms: request.planned_ms,
                allowed: request.allowed,
                now,
                current: app,
            })?;
            let saved = inner
                .machine
                .session()
                .map(|v| (v.persisted(), v.allowed().clone()));
            let Some((saved, allowed)) = saved else {
                return Err(FocusError::NotActive.into());
            };
            match self
                .focus
                .insert(&saved.intent, saved.started_at, saved.planned_end, &allowed)
            {
                Ok(id) => inner.id = Some(id),
                Err(e) => {
                    inner.machine.discard();
                    return Err(e.into());
                }
            }
        }
        self.active(now).ok_or(FocusError::NotActive.into())
    }

    /// What the user looks at changed (or nothing can be observed: `None`).
    pub fn observe(
        &self,
        current: Option<&FocusSnapshot>,
        now: UtcMs,
    ) -> Result<Outcome, FocusServiceError> {
        if self.lock().machine.session().is_none() {
            return Ok(Outcome::default());
        }
        let app = self.app_of(current, now)?;
        self.apply(Event::FocusChanged { app, now }, now)
    }

    /// Time passed: finishes the session or raises a due alert.
    pub fn tick(&self, now: UtcMs) -> Result<Outcome, FocusServiceError> {
        if self.lock().machine.session().is_none() {
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

    /// Ends the session now; returns it with its summary.
    pub fn stop(&self, now: UtcMs) -> Result<StoredFocus, FocusServiceError> {
        let outcome = self.apply(Event::Cancel { now }, now)?;
        outcome.finished.ok_or_else(|| FocusError::NotActive.into())
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
            intent: view.intent().to_owned(),
            remaining_ms: view.remaining_ms(now),
            drifting: view.alerting().is_some(),
        })
    }

    /// Feeds one event to the machine and stores what it decided.
    fn apply(&self, event: Event, now: UtcMs) -> Result<Outcome, FocusServiceError> {
        let (effects, before, id) = {
            let mut inner = self.lock();
            let before = inner.machine.session().map(|v| v.persisted());
            let effects = inner.machine.handle(event)?;
            (effects, before, inner.id)
        };
        let (Some(before), Some(id)) = (before, id) else {
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
                            saved.planned_end,
                            &saved.allowed,
                            saved.drift_alerts,
                        )?;
                    }
                }
                Effect::DriftAlert(app) => {
                    outcome.changed = true;
                    outcome.alert = Some((before.intent.clone(), app));
                }
                Effect::DriftCleared => outcome.changed = true,
                Effect::Finished { reason, at } => {
                    outcome.changed = true;
                    // The alert count may have grown in this very event.
                    let stored = StoredFocus {
                        id,
                        intent: before.intent.clone(),
                        started_at: before.started_at,
                        planned_end: before.planned_end,
                        ended_at: None,
                        end_reason: None,
                        drift_alerts: before.drift_alerts,
                        allowed: before.allowed.clone(),
                        summary: FocusSummary::default(),
                        seen: false,
                    };
                    outcome.finished = Some(self.close(&stored, at, reason, now)?);
                    self.lock().id = None;
                }
            }
        }
        Ok(outcome)
    }

    /// Computes the summary of `[started_at, at)` and stores the closed session.
    fn close(
        &self,
        stored: &StoredFocus,
        at: UtcMs,
        reason: FocusEnd,
        now: UtcMs,
    ) -> Result<StoredFocus, FocusServiceError> {
        let summary = self.summary(stored, at, now)?;
        self.focus.close(stored.id, at, reason, &summary)?;
        Ok(StoredFocus {
            ended_at: Some(at),
            end_reason: Some(reason),
            summary,
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
        let mut empty = request(&r);
        empty.intent = " ".into();
        assert_eq!(
            r.service.start(empty, None, None, UtcMs(T0)),
            Err(FocusServiceError::Invalid(FocusError::EmptyIntent))
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
            intent: "other".into(),
            started_at: UtcMs(1),
            planned_end: UtcMs(2),
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
