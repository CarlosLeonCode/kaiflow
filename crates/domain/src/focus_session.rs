//! Focus sessions: a timed block of work with an intent and a list of allowed activities and
//! apps. Pure: the caller supplies every instant, so nothing here reads a clock.
//!
//! The machine is separate from the tracking machine (`machine.rs`) and knows nothing about
//! tracking. It is told what the user is looking at (`FocusChanged`) and when time passes
//! (`Tick`), and answers with effects: persist, alert about a drift, finish.
//!
//! Drift rule: being outside the allowed set for `drift_after` in a row (90 s by default)
//! raises one gentle alert. Alerts are at least [`ALERT_COOLDOWN_MS`] apart, and a snooze holds
//! them back further. Coming back before the threshold resets the timer without an alert, and
//! a moment with no observation (tracking paused, idle, asleep, stopped, an app hidden by a
//! privacy rule) suspends the rule: it neither counts as outside nor carries over.
//!
//! The summary (percent inside, top distractions) is not tracked live; it is derived from the
//! tracked spans of the session when it closes ([`summarize`]).

use crate::{ActivityId, UtcMs};

/// Outside the allowed set for this long, in a row, raises a drift alert.
pub const DEFAULT_DRIFT_AFTER_MS: i64 = 90_000;
/// Minimum distance between two alerts of one session.
pub const ALERT_COOLDOWN_MS: i64 = 5 * 60_000;
pub const MIN_PLANNED_MS: i64 = 60_000;
/// Planned time of a session, extensions included.
pub const MAX_PLANNED_MS: i64 = 12 * 3_600_000;
pub const MAX_INTENT_CHARS: usize = 80;
/// Distractions kept in a summary.
pub const TOP_DISTRACTIONS: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FocusError {
    EmptyIntent,
    IntentTooLong,
    /// The planned time is outside `MIN_PLANNED_MS..=MAX_PLANNED_MS`.
    BadDuration,
    /// A session with nothing allowed would be a drift from the first second.
    NothingAllowed,
    AlreadyActive,
    NotActive,
}

impl std::fmt::Display for FocusError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::EmptyIntent => "describe what you want to focus on",
            Self::IntentTooLong => "the intent is too long (80 characters at most)",
            Self::BadDuration => "a session lasts between 1 minute and 12 hours",
            Self::NothingAllowed => "allow at least one activity or app",
            Self::AlreadyActive => "a focus session is already running",
            Self::NotActive => "no focus session is running",
        })
    }
}

impl std::error::Error for FocusError {}

/// Why a session ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusEnd {
    /// The planned time ran out.
    Completed,
    /// The user ended it.
    Cancelled,
    /// The app was closed during the session and found it over at startup.
    Recovered,
}

impl FocusEnd {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::Recovered => "recovered",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "completed" => Some(Self::Completed),
            "cancelled" => Some(Self::Cancelled),
            "recovered" => Some(Self::Recovered),
            _ => None,
        }
    }
}

/// What may be used during a session: whole activities and individual apps.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Allowed {
    pub activities: Vec<ActivityId>,
    /// Platform app ids (bundle id, executable name...).
    pub apps: Vec<String>,
}

impl Allowed {
    pub fn is_empty(&self) -> bool {
        self.activities.is_empty() && self.apps.is_empty()
    }

    /// An app is permitted by its own id or by the activity it belongs to.
    pub fn permits(&self, app_id: &str, activity: ActivityId) -> bool {
        self.apps.iter().any(|a| a == app_id) || self.activities.contains(&activity)
    }

    fn deduped(mut self) -> Self {
        self.apps.sort();
        self.apps.dedup();
        self.activities.sort_by_key(|a| a.0);
        self.activities.dedup();
        self
    }
}

/// The app in front, with the activity the rules file it under.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppRef {
    pub app_id: String,
    pub app_name: String,
    pub activity: ActivityId,
}

/// Trims and checks the user-supplied parts of a session.
pub fn validate(intent: &str, planned_ms: i64, allowed: &Allowed) -> Result<String, FocusError> {
    let intent = intent.trim();
    if intent.is_empty() {
        return Err(FocusError::EmptyIntent);
    }
    if intent.chars().count() > MAX_INTENT_CHARS {
        return Err(FocusError::IntentTooLong);
    }
    if !(MIN_PLANNED_MS..=MAX_PLANNED_MS).contains(&planned_ms) {
        return Err(FocusError::BadDuration);
    }
    if allowed.is_empty() {
        return Err(FocusError::NothingAllowed);
    }
    Ok(intent.to_owned())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Config {
    pub drift_after_ms: i64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            drift_after_ms: DEFAULT_DRIFT_AFTER_MS,
        }
    }
}

/// A session as stored, enough to resume it after a restart.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Persisted {
    pub intent: String,
    pub started_at: UtcMs,
    pub planned_end: UtcMs,
    pub allowed: Allowed,
    pub drift_alerts: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Start {
        intent: String,
        planned_ms: i64,
        allowed: Allowed,
        now: UtcMs,
        /// What is in front right now, if anything is observed.
        current: Option<AppRef>,
    },
    /// The observed app changed; `None` when nothing can be observed (suspends the drift rule).
    FocusChanged {
        app: Option<AppRef>,
        now: UtcMs,
    },
    Tick {
        now: UtcMs,
    },
    /// Adds time to the session.
    Extend {
        by_ms: i64,
        now: UtcMs,
    },
    /// The user ends the session.
    Cancel {
        now: UtcMs,
    },
    /// "Back to it": acknowledges the alert and holds further ones back until `until`.
    Snooze {
        until: UtcMs,
        now: UtcMs,
    },
    /// "Allow this app": adds an app to the allowed set for the rest of the session.
    Allow {
        app_id: String,
        now: UtcMs,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// The session began (store it).
    Started,
    /// Planned end, allowed set or alert count changed (store them).
    Updated,
    /// A drift alert is due for this app.
    DriftAlert(AppRef),
    /// The alert no longer applies (back inside, snoozed, suspended).
    DriftCleared,
    /// The session is over; `at` is its end instant.
    Finished { reason: FocusEnd, at: UtcMs },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Active {
    intent: String,
    started_at: UtcMs,
    planned_end: UtcMs,
    allowed: Allowed,
    drift_alerts: u32,
    current: Option<AppRef>,
    outside_since: Option<UtcMs>,
    last_alert: Option<UtcMs>,
    snoozed_until: Option<UtcMs>,
    alerting: bool,
}

impl Active {
    fn is_outside(&self) -> bool {
        self.current
            .as_ref()
            .is_some_and(|a| !self.allowed.permits(&a.app_id, a.activity))
    }

    /// When the next alert is due: after the threshold, the cooldown and any snooze.
    fn alert_at(&self, config: &Config) -> Option<UtcMs> {
        let since = self.outside_since?;
        let mut at = since.plus_ms(config.drift_after_ms);
        if let Some(last) = self.last_alert {
            at = at.max(last.plus_ms(ALERT_COOLDOWN_MS));
        }
        if let Some(until) = self.snoozed_until {
            at = at.max(until);
        }
        Some(at)
    }

    /// Starts or stops the outside timer to match what is in front now.
    fn reevaluate(&mut self, now: UtcMs) -> Vec<Effect> {
        let mut effects = Vec::new();
        if self.is_outside() {
            self.outside_since.get_or_insert(now);
        } else {
            self.outside_since = None;
            if self.alerting {
                self.alerting = false;
                effects.push(Effect::DriftCleared);
            }
        }
        effects
    }
}

/// The focus session machine; at most one session at a time.
#[derive(Debug, Clone, Default)]
pub struct FocusMachine {
    config: Config,
    active: Option<Active>,
}

/// Read-only view of the running session.
#[derive(Debug, Clone, Copy)]
pub struct SessionView<'a>(&'a Active);

impl SessionView<'_> {
    pub fn intent(&self) -> &str {
        &self.0.intent
    }
    pub fn started_at(&self) -> UtcMs {
        self.0.started_at
    }
    pub fn planned_end(&self) -> UtcMs {
        self.0.planned_end
    }
    pub fn allowed(&self) -> &Allowed {
        &self.0.allowed
    }
    pub fn drift_alerts(&self) -> u32 {
        self.0.drift_alerts
    }
    pub fn current(&self) -> Option<&AppRef> {
        self.0.current.as_ref()
    }
    /// The app an unacknowledged alert is about.
    pub fn alerting(&self) -> Option<&AppRef> {
        self.0.alerting.then_some(self.0.current.as_ref()).flatten()
    }
    pub fn remaining_ms(&self, now: UtcMs) -> i64 {
        self.0.planned_end.since(now).max(0)
    }
    pub fn persisted(&self) -> Persisted {
        Persisted {
            intent: self.0.intent.clone(),
            started_at: self.0.started_at,
            planned_end: self.0.planned_end,
            allowed: self.0.allowed.clone(),
            drift_alerts: self.0.drift_alerts,
        }
    }
}

impl FocusMachine {
    pub fn new(config: Config) -> Self {
        Self {
            config,
            active: None,
        }
    }

    pub fn set_config(&mut self, config: Config) {
        self.config = config;
    }

    /// Resumes a stored session after a restart. Timers start afresh at `now`.
    pub fn restore(&mut self, saved: Persisted, current: Option<AppRef>, now: UtcMs) {
        let mut active = Active {
            intent: saved.intent,
            started_at: saved.started_at,
            planned_end: saved.planned_end,
            allowed: saved.allowed.deduped(),
            drift_alerts: saved.drift_alerts,
            current,
            outside_since: None,
            last_alert: None,
            snoozed_until: None,
            alerting: false,
        };
        active.reevaluate(now);
        self.active = Some(active);
    }

    /// Forgets the session without effects (a failed store after `Start`).
    pub fn discard(&mut self) {
        self.active = None;
    }

    pub fn session(&self) -> Option<SessionView<'_>> {
        self.active.as_ref().map(SessionView)
    }

    /// The next instant `Tick` has something to do: the planned end or the next alert.
    pub fn next_deadline(&self) -> Option<UtcMs> {
        let active = self.active.as_ref()?;
        Some(
            active
                .alert_at(&self.config)
                .map_or(active.planned_end, |at| at.min(active.planned_end)),
        )
    }

    pub fn handle(&mut self, event: Event) -> Result<Vec<Effect>, FocusError> {
        match event {
            Event::Start {
                intent,
                planned_ms,
                allowed,
                now,
                current,
            } => {
                if self.active.is_some() {
                    return Err(FocusError::AlreadyActive);
                }
                let intent = validate(&intent, planned_ms, &allowed)?;
                let mut active = Active {
                    intent,
                    started_at: now,
                    planned_end: now.plus_ms(planned_ms),
                    allowed: allowed.deduped(),
                    drift_alerts: 0,
                    current,
                    outside_since: None,
                    last_alert: None,
                    snoozed_until: None,
                    alerting: false,
                };
                active.reevaluate(now);
                self.active = Some(active);
                Ok(vec![Effect::Started])
            }
            Event::Tick { now } => self.advance(now),
            Event::FocusChanged { app, now } => {
                let mut effects = self.advance(now)?;
                if finished(&effects) {
                    return Ok(effects);
                }
                let active = self.active.as_mut().ok_or(FocusError::NotActive)?;
                active.current = app;
                effects.extend(active.reevaluate(now));
                Ok(effects)
            }
            Event::Extend { by_ms, now } => {
                let effects = self.advance(now)?;
                if finished(&effects) {
                    return Ok(effects);
                }
                let active = self.active.as_mut().ok_or(FocusError::NotActive)?;
                let total = active
                    .planned_end
                    .since(active.started_at)
                    .saturating_add(by_ms);
                if by_ms <= 0 || total > MAX_PLANNED_MS {
                    return Err(FocusError::BadDuration);
                }
                active.planned_end = active.planned_end.plus_ms(by_ms);
                Ok(vec![Effect::Updated])
            }
            Event::Cancel { now } => {
                let active = self.active.take().ok_or(FocusError::NotActive)?;
                Ok(vec![Effect::Finished {
                    reason: FocusEnd::Cancelled,
                    at: now.max(active.started_at),
                }])
            }
            Event::Snooze { until, now } => {
                let mut effects = self.advance(now)?;
                if finished(&effects) {
                    return Ok(effects);
                }
                let active = self.active.as_mut().ok_or(FocusError::NotActive)?;
                active.snoozed_until = Some(until);
                if active.alerting {
                    active.alerting = false;
                    effects.push(Effect::DriftCleared);
                }
                Ok(effects)
            }
            Event::Allow { app_id, now } => {
                let mut effects = self.advance(now)?;
                if finished(&effects) {
                    return Ok(effects);
                }
                let active = self.active.as_mut().ok_or(FocusError::NotActive)?;
                if !active.allowed.apps.contains(&app_id) {
                    active.allowed.apps.push(app_id);
                    active.allowed.apps.sort();
                    effects.push(Effect::Updated);
                }
                effects.extend(active.reevaluate(now));
                Ok(effects)
            }
        }
    }

    /// Time passed: finish at the planned end, or raise a due alert.
    fn advance(&mut self, now: UtcMs) -> Result<Vec<Effect>, FocusError> {
        let config = self.config;
        let active = self.active.as_mut().ok_or(FocusError::NotActive)?;
        if now >= active.planned_end {
            let at = active.planned_end;
            self.active = None;
            return Ok(vec![Effect::Finished {
                reason: FocusEnd::Completed,
                at,
            }]);
        }
        let due = active.alert_at(&config).is_some_and(|at| now >= at);
        if due && let Some(app) = active.current.clone() {
            active.alerting = true;
            active.last_alert = Some(now);
            active.drift_alerts += 1;
            return Ok(vec![Effect::DriftAlert(app), Effect::Updated]);
        }
        Ok(Vec::new())
    }
}

fn finished(effects: &[Effect]) -> bool {
    effects.iter().any(|e| matches!(e, Effect::Finished { .. }))
}

/// A tracked stretch of the session, already cut to the session's bounds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Span {
    pub app_id: String,
    pub app_name: String,
    pub activity: ActivityId,
    pub start: UtcMs,
    pub end: UtcMs,
}

/// An app that took time away from the session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Distraction {
    pub app_id: String,
    pub app_name: String,
    pub ms: i64,
}

/// How the tracked time of a session split between allowed and not.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Summary {
    pub inside_ms: i64,
    pub outside_ms: i64,
    /// Most time first, at most [`TOP_DISTRACTIONS`].
    pub top_distractions: Vec<Distraction>,
}

impl Summary {
    /// Share of the tracked time spent inside, in whole percent; `None` without tracked time.
    pub fn percent_inside(&self) -> Option<u32> {
        let total = self.inside_ms + self.outside_ms;
        if total <= 0 {
            return None;
        }
        let pct = (self.inside_ms * 100 + total / 2) / total;
        u32::try_from(pct.clamp(0, 100)).ok()
    }
}

/// Splits the spans into inside and outside time and ranks the apps outside.
pub fn summarize(spans: &[Span], allowed: &Allowed) -> Summary {
    let mut summary = Summary::default();
    let mut outside: Vec<Distraction> = Vec::new();
    for span in spans {
        let ms = span.end.since(span.start);
        if ms <= 0 {
            continue;
        }
        if allowed.permits(&span.app_id, span.activity) {
            summary.inside_ms += ms;
            continue;
        }
        summary.outside_ms += ms;
        match outside.iter_mut().find(|d| d.app_id == span.app_id) {
            Some(d) => d.ms += ms,
            None => outside.push(Distraction {
                app_id: span.app_id.clone(),
                app_name: span.app_name.clone(),
                ms,
            }),
        }
    }
    outside.sort_by(|a, b| b.ms.cmp(&a.ms).then_with(|| a.app_name.cmp(&b.app_name)));
    outside.truncate(TOP_DISTRACTIONS);
    summary.top_distractions = outside;
    summary
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: i64 = 1_000;
    const MIN: i64 = 60 * S;

    fn app(id: &str, activity: i64) -> AppRef {
        AppRef {
            app_id: id.into(),
            app_name: id.to_uppercase(),
            activity: ActivityId(activity),
        }
    }

    fn allowed() -> Allowed {
        Allowed {
            activities: vec![ActivityId(2)],
            apps: vec!["excel".into()],
        }
    }

    fn started(current: Option<AppRef>) -> FocusMachine {
        let mut m = FocusMachine::new(Config::default());
        m.handle(Event::Start {
            intent: " Write report ".into(),
            planned_ms: 50 * MIN,
            allowed: allowed(),
            now: UtcMs(0),
            current,
        })
        .unwrap();
        m
    }

    fn focus(m: &mut FocusMachine, app: Option<AppRef>, at: i64) -> Vec<Effect> {
        m.handle(Event::FocusChanged {
            app,
            now: UtcMs(at),
        })
        .unwrap()
    }

    fn tick(m: &mut FocusMachine, at: i64) -> Vec<Effect> {
        m.handle(Event::Tick { now: UtcMs(at) }).unwrap()
    }

    fn alerts(effects: &[Effect]) -> usize {
        effects
            .iter()
            .filter(|e| matches!(e, Effect::DriftAlert(_)))
            .count()
    }

    #[test]
    fn a_session_starts_with_a_trimmed_intent_and_a_planned_end() {
        let m = started(None);
        let view = m.session().unwrap();
        assert_eq!(view.intent(), "Write report");
        assert_eq!(view.planned_end(), UtcMs(50 * MIN));
        assert_eq!(view.remaining_ms(UtcMs(20 * MIN)), 30 * MIN);
        assert_eq!(view.remaining_ms(UtcMs(99 * MIN)), 0);
    }

    #[test]
    fn start_is_validated() {
        let go = |intent: &str, planned_ms: i64, allowed: Allowed| {
            FocusMachine::default().handle(Event::Start {
                intent: intent.into(),
                planned_ms,
                allowed,
                now: UtcMs(0),
                current: None,
            })
        };
        assert_eq!(go("  ", 25 * MIN, allowed()), Err(FocusError::EmptyIntent));
        assert_eq!(
            go(&"x".repeat(81), 25 * MIN, allowed()),
            Err(FocusError::IntentTooLong)
        );
        assert_eq!(go("a", 30 * S, allowed()), Err(FocusError::BadDuration));
        assert_eq!(
            go("a", 13 * 3_600_000, allowed()),
            Err(FocusError::BadDuration)
        );
        assert_eq!(
            go("a", 25 * MIN, Allowed::default()),
            Err(FocusError::NothingAllowed)
        );
        assert!(go(&"x".repeat(80), 25 * MIN, allowed()).is_ok());
    }

    #[test]
    fn only_one_session_runs_at_a_time() {
        let mut m = started(None);
        let again = m.handle(Event::Start {
            intent: "b".into(),
            planned_ms: 25 * MIN,
            allowed: allowed(),
            now: UtcMs(1),
            current: None,
        });
        assert_eq!(again, Err(FocusError::AlreadyActive));
    }

    #[test]
    fn ninety_one_seconds_outside_raises_one_alert() {
        let mut m = started(Some(app("excel", 9)));
        assert!(focus(&mut m, Some(app("slack", 5)), 10 * S).is_empty());
        assert_eq!(m.next_deadline(), Some(UtcMs(100 * S)));
        assert_eq!(
            alerts(&tick(&mut m, 99 * S)),
            0,
            "89 s outside: nothing yet"
        );
        let effects = tick(&mut m, 101 * S);
        assert_eq!(alerts(&effects), 1);
        assert!(effects.contains(&Effect::Updated));
        assert_eq!(m.session().unwrap().drift_alerts(), 1);
        assert_eq!(m.session().unwrap().alerting().unwrap().app_id, "slack");
        assert_eq!(
            alerts(&tick(&mut m, 102 * S)),
            0,
            "never twice for one stretch"
        );
    }

    #[test]
    fn coming_back_after_sixty_seconds_raises_nothing() {
        let mut m = started(Some(app("excel", 9)));
        focus(&mut m, Some(app("slack", 5)), 0);
        assert_eq!(alerts(&tick(&mut m, 60 * S)), 0);
        assert!(focus(&mut m, Some(app("excel", 9)), 60 * S).is_empty());
        assert_eq!(alerts(&tick(&mut m, 200 * S)), 0);
        assert_eq!(m.session().unwrap().drift_alerts(), 0);
        // The timer restarted: a new stretch needs its own 90 s.
        focus(&mut m, Some(app("slack", 5)), 300 * S);
        assert_eq!(alerts(&tick(&mut m, 380 * S)), 0);
        assert_eq!(alerts(&tick(&mut m, 391 * S)), 1);
    }

    #[test]
    fn an_activity_in_the_allowed_set_counts_as_inside() {
        let mut m = started(None);
        focus(&mut m, Some(app("code", 2)), 0);
        assert_eq!(m.next_deadline(), Some(UtcMs(50 * MIN)));
        assert_eq!(alerts(&tick(&mut m, 10 * MIN)), 0);
    }

    #[test]
    fn switching_between_outside_apps_keeps_the_stretch_going() {
        let mut m = started(None);
        focus(&mut m, Some(app("slack", 5)), 0);
        focus(&mut m, Some(app("mail", 6)), 60 * S);
        assert_eq!(alerts(&tick(&mut m, 91 * S)), 1);
        assert_eq!(m.session().unwrap().alerting().unwrap().app_id, "mail");
    }

    #[test]
    fn alerts_are_at_least_five_minutes_apart() {
        let mut m = started(None);
        focus(&mut m, Some(app("slack", 5)), 0);
        assert_eq!(alerts(&tick(&mut m, 91 * S)), 1);
        // Back inside, then out again within the cooldown: the alert waits for it to pass.
        let back = focus(&mut m, Some(app("excel", 9)), 100 * S);
        assert_eq!(back, vec![Effect::DriftCleared]);
        focus(&mut m, Some(app("slack", 5)), 110 * S);
        assert_eq!(m.next_deadline(), Some(UtcMs(91 * S + ALERT_COOLDOWN_MS)));
        assert_eq!(alerts(&tick(&mut m, 250 * S)), 0);
        assert_eq!(alerts(&tick(&mut m, 91 * S + ALERT_COOLDOWN_MS)), 1);
        assert_eq!(m.session().unwrap().drift_alerts(), 2);
    }

    #[test]
    fn staying_outside_reminds_once_per_cooldown() {
        let mut m = started(None);
        focus(&mut m, Some(app("slack", 5)), 0);
        assert_eq!(alerts(&tick(&mut m, 91 * S)), 1);
        assert_eq!(alerts(&tick(&mut m, 4 * MIN)), 0);
        assert_eq!(alerts(&tick(&mut m, 91 * S + ALERT_COOLDOWN_MS)), 1);
    }

    #[test]
    fn no_observation_suspends_the_rule_and_clears_the_alert() {
        let mut m = started(None);
        focus(&mut m, Some(app("slack", 5)), 0);
        assert_eq!(alerts(&tick(&mut m, 91 * S)), 1);
        // Paused / idle / asleep: nothing is observed.
        assert_eq!(focus(&mut m, None, 100 * S), vec![Effect::DriftCleared]);
        assert_eq!(m.next_deadline(), Some(UtcMs(50 * MIN)));
        assert_eq!(alerts(&tick(&mut m, 20 * MIN)), 0);
        // The outside time before the pause does not carry over.
        focus(&mut m, Some(app("slack", 5)), 30 * MIN);
        assert_eq!(alerts(&tick(&mut m, 30 * MIN + 80 * S)), 0);
        assert_eq!(alerts(&tick(&mut m, 30 * MIN + 91 * S)), 1);
    }

    #[test]
    fn snooze_acknowledges_the_alert_and_holds_the_next_one_back() {
        let mut m = started(None);
        focus(&mut m, Some(app("slack", 5)), 0);
        tick(&mut m, 91 * S);
        let effects = m
            .handle(Event::Snooze {
                until: UtcMs(20 * MIN),
                now: UtcMs(100 * S),
            })
            .unwrap();
        assert_eq!(effects, vec![Effect::DriftCleared]);
        assert!(m.session().unwrap().alerting().is_none());
        assert_eq!(alerts(&tick(&mut m, 19 * MIN)), 0);
        assert_eq!(alerts(&tick(&mut m, 20 * MIN)), 1);
    }

    #[test]
    fn allowing_the_app_in_front_ends_the_drift() {
        let mut m = started(None);
        focus(&mut m, Some(app("slack", 5)), 0);
        tick(&mut m, 91 * S);
        let effects = m
            .handle(Event::Allow {
                app_id: "slack".into(),
                now: UtcMs(95 * S),
            })
            .unwrap();
        assert!(effects.contains(&Effect::Updated));
        assert!(effects.contains(&Effect::DriftCleared));
        assert!(
            m.session()
                .unwrap()
                .allowed()
                .apps
                .contains(&"slack".to_owned())
        );
        assert_eq!(alerts(&tick(&mut m, 30 * MIN)), 0);
    }

    #[test]
    fn allowing_an_app_twice_changes_nothing() {
        let mut m = started(None);
        let effects = m
            .handle(Event::Allow {
                app_id: "excel".into(),
                now: UtcMs(S),
            })
            .unwrap();
        assert!(effects.is_empty());
    }

    #[test]
    fn the_planned_end_finishes_the_session_at_the_planned_instant() {
        let mut m = started(None);
        let effects = tick(&mut m, 50 * MIN + 7 * S);
        assert_eq!(
            effects,
            vec![Effect::Finished {
                reason: FocusEnd::Completed,
                at: UtcMs(50 * MIN)
            }]
        );
        assert!(m.session().is_none());
        assert_eq!(m.next_deadline(), None);
        assert_eq!(
            m.handle(Event::Tick {
                now: UtcMs(51 * MIN)
            }),
            Err(FocusError::NotActive)
        );
    }

    #[test]
    fn a_late_event_still_finishes_the_session_first() {
        let mut m = started(None);
        let effects = focus(&mut m, Some(app("slack", 5)), 60 * MIN);
        assert!(finished(&effects));
        assert!(m.session().is_none());
    }

    #[test]
    fn extending_moves_the_end_and_is_capped() {
        let mut m = started(None);
        let effects = m
            .handle(Event::Extend {
                by_ms: 10 * MIN,
                now: UtcMs(40 * MIN),
            })
            .unwrap();
        assert_eq!(effects, vec![Effect::Updated]);
        assert_eq!(m.session().unwrap().planned_end(), UtcMs(60 * MIN));
        assert_eq!(
            m.handle(Event::Extend {
                by_ms: MAX_PLANNED_MS,
                now: UtcMs(41 * MIN)
            }),
            Err(FocusError::BadDuration)
        );
        assert_eq!(
            m.handle(Event::Extend {
                by_ms: 0,
                now: UtcMs(41 * MIN)
            }),
            Err(FocusError::BadDuration)
        );
    }

    #[test]
    fn cancel_ends_the_session_now() {
        let mut m = started(None);
        let effects = m
            .handle(Event::Cancel {
                now: UtcMs(7 * MIN),
            })
            .unwrap();
        assert_eq!(
            effects,
            vec![Effect::Finished {
                reason: FocusEnd::Cancelled,
                at: UtcMs(7 * MIN)
            }]
        );
        assert_eq!(
            m.handle(Event::Cancel {
                now: UtcMs(8 * MIN)
            }),
            Err(FocusError::NotActive)
        );
    }

    #[test]
    fn the_drift_threshold_is_configurable() {
        let mut m = FocusMachine::new(Config {
            drift_after_ms: 30 * S,
        });
        m.handle(Event::Start {
            intent: "a".into(),
            planned_ms: 25 * MIN,
            allowed: allowed(),
            now: UtcMs(0),
            current: Some(app("slack", 5)),
        })
        .unwrap();
        assert_eq!(alerts(&tick(&mut m, 31 * S)), 1);
    }

    #[test]
    fn a_restored_session_resumes_with_fresh_timers() {
        let mut m = FocusMachine::default();
        m.restore(
            Persisted {
                intent: "Write report".into(),
                started_at: UtcMs(0),
                planned_end: UtcMs(50 * MIN),
                allowed: allowed(),
                drift_alerts: 2,
            },
            Some(app("slack", 5)),
            UtcMs(20 * MIN),
        );
        let view = m.session().unwrap();
        assert_eq!(view.drift_alerts(), 2);
        assert_eq!(view.remaining_ms(UtcMs(20 * MIN)), 30 * MIN);
        assert_eq!(m.next_deadline(), Some(UtcMs(20 * MIN + 90 * S)));
    }

    fn span(app_id: &str, activity: i64, start: i64, end: i64) -> Span {
        Span {
            app_id: app_id.into(),
            app_name: app_id.to_uppercase(),
            activity: ActivityId(activity),
            start: UtcMs(start),
            end: UtcMs(end),
        }
    }

    #[test]
    fn the_summary_splits_inside_and_outside_and_ranks_distractions() {
        let spans = [
            span("excel", 9, 0, 30 * MIN),
            span("code", 2, 30 * MIN, 35 * MIN),
            span("slack", 5, 35 * MIN, 40 * MIN),
            span("mail", 6, 40 * MIN, 42 * MIN),
            span("slack", 5, 42 * MIN, 45 * MIN),
        ];
        let s = summarize(&spans, &allowed());
        assert_eq!((s.inside_ms, s.outside_ms), (35 * MIN, 10 * MIN));
        assert_eq!(s.percent_inside(), Some(78));
        assert_eq!(s.top_distractions.len(), 2);
        assert_eq!(
            (
                s.top_distractions[0].app_id.as_str(),
                s.top_distractions[0].ms
            ),
            ("slack", 8 * MIN)
        );
        assert_eq!(s.top_distractions[1].app_id, "mail");
    }

    #[test]
    fn the_summary_keeps_at_most_three_distractions() {
        let spans: Vec<Span> = (0..6)
            .map(|i| span(&format!("app{i}"), 5, i * MIN, i * MIN + (i + 1) * 1_000))
            .collect();
        let s = summarize(&spans, &allowed());
        assert_eq!(s.top_distractions.len(), TOP_DISTRACTIONS);
        assert_eq!(s.top_distractions[0].app_id, "app5");
    }

    #[test]
    fn a_session_without_tracked_time_has_no_percentage() {
        let s = summarize(&[], &allowed());
        assert_eq!(s.percent_inside(), None);
        assert!(s.top_distractions.is_empty());
        let only_outside = summarize(&[span("slack", 5, 0, MIN)], &allowed());
        assert_eq!(only_outside.percent_inside(), Some(0));
    }

    mod props {
        use super::*;
        use proptest::prelude::*;

        proptest! {
            #[test]
            fn the_summary_accounts_for_every_millisecond(
                parts in prop::collection::vec((0usize..4, 1i64..10_000), 0..30)
            ) {
                let mut t = 0;
                let spans: Vec<Span> = parts
                    .iter()
                    .map(|(app, len)| {
                        let s = span(["excel", "slack", "mail", "code"][*app], if *app == 3 { 2 } else { 5 }, t, t + len);
                        t += len;
                        s
                    })
                    .collect();
                let total: i64 = spans.iter().map(|s| s.end.since(s.start)).sum();
                let summary = summarize(&spans, &allowed());
                prop_assert_eq!(summary.inside_ms + summary.outside_ms, total);
                prop_assert!(summary.percent_inside().is_none_or(|p| p <= 100));
                prop_assert!(summary.top_distractions.len() <= TOP_DISTRACTIONS);
                let listed: i64 = summary.top_distractions.iter().map(|d| d.ms).sum();
                prop_assert!(listed <= summary.outside_ms);
            }

            #[test]
            fn alerts_never_come_closer_than_the_cooldown(
                steps in prop::collection::vec((0i64..400_000, any::<bool>()), 1..60)
            ) {
                let mut m = FocusMachine::default();
                m.handle(Event::Start {
                    intent: "a".into(),
                    planned_ms: MAX_PLANNED_MS,
                    allowed: allowed(),
                    now: UtcMs(0),
                    current: None,
                })
                .unwrap();
                let (mut now, mut last_alert) = (0i64, None::<i64>);
                for (advance, outside) in steps {
                    now += advance;
                    let effects = m
                        .handle(Event::FocusChanged {
                            app: Some(if outside { app("slack", 5) } else { app("excel", 9) }),
                            now: UtcMs(now),
                        })
                        .unwrap();
                    let mut all = effects;
                    all.extend(m.handle(Event::Tick { now: UtcMs(now) }).unwrap());
                    for effect in all {
                        if matches!(effect, Effect::DriftAlert(_)) {
                            if let Some(last) = last_alert {
                                prop_assert!(now - last >= ALERT_COOLDOWN_MS);
                            }
                            last_alert = Some(now);
                        }
                    }
                }
            }
        }
    }
}
