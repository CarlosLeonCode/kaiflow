//! Goals on tracked time and their streaks. Pure: the caller supplies the totals and the
//! local day numbers (days since 1970-01-01), so nothing here reads a clock or a time zone.
//!
//! A goal targets an activity, an app or all tracked time over a daily, weekly or monthly
//! period. A *minimum* goal is met once the total reaches the target; a *maximum* goal is met
//! when the total is still at or under the target when the period closes. Neither ever blocks
//! anything: crossing a threshold only produces an event for the caller to announce.

use crate::calendar::{ALL_DAYS, Period, mask_has, weekday_of};
use crate::{ActivityId, UtcMs};

/// Longest label a goal may have.
pub const MAX_LABEL_CHARS: usize = 60;

const DAY_MS: i64 = 86_400_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GoalScope {
    Activity(ActivityId),
    /// An app, by its platform id (bundle id, executable name...).
    App(String),
    /// Every tracked millisecond.
    Total,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoalKind {
    /// "At least": reach the target.
    Minimum,
    /// "At most": stay under the target.
    Maximum,
}

impl GoalKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Minimum => "minimum",
            Self::Maximum => "maximum",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "minimum" => Some(Self::Minimum),
            "maximum" => Some(Self::Maximum),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Goal {
    /// `<= 0` until stored.
    pub id: i64,
    pub label: String,
    pub scope: GoalScope,
    pub period: Period,
    pub kind: GoalKind,
    pub target_ms: i64,
    /// Bit 0 = Monday .. bit 6 = Sunday. Only daily goals use it; the other periods count
    /// every day.
    pub active_days: u8,
    /// Archived goals are kept but neither shown as progress nor announced.
    pub archived: bool,
    pub created_at: UtcMs,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GoalError {
    EmptyLabel,
    LabelTooLong,
    /// The target is zero, negative or longer than the period itself.
    InvalidTarget,
    /// No active day selected (or bits outside Monday..Sunday).
    InvalidDays,
    EmptyApp,
}

impl std::fmt::Display for GoalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::EmptyLabel => "a goal needs a name",
            Self::LabelTooLong => "the goal name is too long (60 characters at most)",
            Self::InvalidTarget => "the target must be longer than zero and fit in the period",
            Self::InvalidDays => "choose at least one active day",
            Self::EmptyApp => "choose an app",
        })
    }
}

impl std::error::Error for GoalError {}

impl Goal {
    pub fn validate(&self) -> Result<(), GoalError> {
        let label = self.label.trim();
        if label.is_empty() {
            return Err(GoalError::EmptyLabel);
        }
        if label.chars().count() > MAX_LABEL_CHARS {
            return Err(GoalError::LabelTooLong);
        }
        let longest = match self.period {
            Period::Daily => DAY_MS,
            Period::Weekly => 7 * DAY_MS,
            Period::Monthly => 31 * DAY_MS,
        };
        if self.target_ms <= 0 || self.target_ms > longest {
            return Err(GoalError::InvalidTarget);
        }
        if self.active_days == 0 || self.active_days & !ALL_DAYS != 0 {
            return Err(GoalError::InvalidDays);
        }
        if matches!(&self.scope, GoalScope::App(app) if app.trim().is_empty()) {
            return Err(GoalError::EmptyApp);
        }
        Ok(())
    }

    /// Whether the period starting at `period_start_day` counts. Rest days of a daily goal
    /// neither count nor break a streak.
    pub fn is_active_on(&self, period_start_day: i64) -> bool {
        self.period != Period::Daily || mask_has(self.active_days, weekday_of(period_start_day))
    }

    /// Whether time spent in `activity` / `app_id` counts towards this goal.
    pub fn counts(&self, activity: ActivityId, app_id: Option<&str>) -> bool {
        match &self.scope {
            GoalScope::Total => true,
            GoalScope::Activity(id) => *id == activity,
            GoalScope::App(app) => app_id == Some(app.as_str()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoalState {
    /// A minimum not reached yet, or a maximum still within its budget.
    Pending,
    /// A minimum goal reached its target.
    Reached,
    /// A maximum goal went over its target.
    Exceeded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    pub actual_ms: i64,
    pub target_ms: i64,
    /// `actual / target` in whole percent, rounded down; may pass 100.
    pub percent: u32,
    pub state: GoalState,
}

pub fn progress(goal: &Goal, actual_ms: i64) -> Progress {
    let actual_ms = actual_ms.max(0);
    let state = match goal.kind {
        GoalKind::Minimum if actual_ms >= goal.target_ms => GoalState::Reached,
        GoalKind::Maximum if actual_ms > goal.target_ms => GoalState::Exceeded,
        _ => GoalState::Pending,
    };
    let percent = (i128::from(actual_ms) * 100 / i128::from(goal.target_ms.max(1)))
        .clamp(0, i128::from(u32::MAX)) as u32;
    Progress {
        actual_ms,
        target_ms: goal.target_ms,
        percent,
        state,
    }
}

/// What a threshold crossing is called in the event log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    Reached,
    Exceeded,
}

impl EventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Reached => "reached",
            Self::Exceeded => "exceeded",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "reached" => Some(Self::Reached),
            "exceeded" => Some(Self::Exceeded),
            _ => None,
        }
    }
}

/// The event produced when the period total moves from `before_ms` to `after_ms`.
pub fn crossing(goal: &Goal, before_ms: i64, after_ms: i64) -> Option<EventKind> {
    let state = |ms| progress(goal, ms).state;
    match (state(before_ms), state(after_ms)) {
        (GoalState::Pending, GoalState::Reached) => Some(EventKind::Reached),
        (GoalState::Pending, GoalState::Exceeded) => Some(EventKind::Exceeded),
        _ => None,
    }
}

/// Tracked time still needed before the goal crosses its threshold, or `None` when it
/// already did. A maximum is crossed one millisecond after its target.
pub fn ms_until_crossing(goal: &Goal, actual_ms: i64) -> Option<i64> {
    let actual_ms = actual_ms.max(0);
    match goal.kind {
        GoalKind::Minimum => (actual_ms < goal.target_ms).then(|| goal.target_ms - actual_ms),
        GoalKind::Maximum => (actual_ms <= goal.target_ms).then(|| goal.target_ms - actual_ms + 1),
    }
}

/// Whether a *closed* period counts as met.
pub fn is_met(goal: &Goal, total_ms: i64) -> bool {
    let total_ms = total_ms.max(0);
    match goal.kind {
        GoalKind::Minimum => total_ms >= goal.target_ms,
        GoalKind::Maximum => total_ms <= goal.target_ms,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Met,
    Missed,
    /// A rest day of a daily goal: skipped.
    Inactive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClosedPeriod {
    pub start_day: i64,
    pub outcome: Outcome,
}

/// The period that is still open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CurrentPeriod {
    pub start_day: i64,
    pub kind: GoalKind,
    pub state: GoalState,
    pub active: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Streak {
    /// Consecutive met periods, ending now.
    pub current: u32,
    /// Longest run in the data available.
    pub best: u32,
    /// First day of the run that makes up `current`.
    pub start_day: Option<i64>,
    /// The open period is not met (yet): it will end the streak if it closes as it is.
    pub at_risk: bool,
}

/// Streak over `closed` periods (oldest first) plus the open one.
///
/// Rest days are skipped, a missed period resets the run, and the open period never breaks
/// it: a reached minimum adds one, an unreached minimum or an exceeded maximum only flags
/// the streak as at risk. A maximum still within budget is neither counted nor at risk (its
/// result is not known until the period closes).
pub fn streak(closed: &[ClosedPeriod], open: &CurrentPeriod) -> Streak {
    let (mut run, mut best, mut start) = (0u32, 0u32, None);
    for period in closed {
        match period.outcome {
            Outcome::Inactive => {}
            Outcome::Missed => {
                run = 0;
                start = None;
            }
            Outcome::Met => {
                if run == 0 {
                    start = Some(period.start_day);
                }
                run += 1;
                best = best.max(run);
            }
        }
    }
    let mut at_risk = false;
    if open.active {
        match (open.kind, open.state) {
            (GoalKind::Minimum, GoalState::Reached) => {
                if run == 0 {
                    start = Some(open.start_day);
                }
                run += 1;
                best = best.max(run);
            }
            (GoalKind::Minimum, _) | (GoalKind::Maximum, GoalState::Exceeded) => at_risk = true,
            (GoalKind::Maximum, _) => {}
        }
    }
    Streak {
        current: run,
        best,
        start_day: start,
        at_risk,
    }
}

/// How many days of a streak starting on `streak_start_day` a purge of everything before
/// `cutoff_day` would remove; `None` when the streak begins on or after the cutoff.
pub fn retention_cuts_streak(cutoff_day: i64, streak_start_day: i64) -> Option<u32> {
    (streak_start_day < cutoff_day)
        .then(|| u32::try_from(cutoff_day - streak_start_day).unwrap_or(u32::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    const H: i64 = 3_600_000;

    fn goal(kind: GoalKind, target_ms: i64) -> Goal {
        Goal {
            id: 1,
            label: "Deep work".into(),
            scope: GoalScope::Activity(ActivityId(2)),
            period: Period::Daily,
            kind,
            target_ms,
            active_days: 0b001_1111,
            archived: false,
            created_at: UtcMs(0),
        }
    }

    fn closed(days: &[(i64, Outcome)]) -> Vec<ClosedPeriod> {
        days.iter()
            .map(|(start_day, outcome)| ClosedPeriod {
                start_day: *start_day,
                outcome: *outcome,
            })
            .collect()
    }

    fn open(kind: GoalKind, state: GoalState, active: bool) -> CurrentPeriod {
        CurrentPeriod {
            start_day: 100,
            kind,
            state,
            active,
        }
    }

    #[test]
    fn a_minimum_is_reached_at_exactly_the_target() {
        let g = goal(GoalKind::Minimum, 2 * H);
        assert_eq!(progress(&g, 2 * H - 1).state, GoalState::Pending);
        assert_eq!(progress(&g, 2 * H).state, GoalState::Reached);
        assert_eq!(progress(&g, 3 * H).percent, 150);
        assert_eq!(progress(&g, H).percent, 50);
    }

    #[test]
    fn a_maximum_is_exceeded_only_past_the_target() {
        let g = goal(GoalKind::Maximum, H);
        assert_eq!(progress(&g, H).state, GoalState::Pending);
        assert_eq!(progress(&g, H + 1).state, GoalState::Exceeded);
        assert!(is_met(&g, H));
        assert!(!is_met(&g, H + 1));
    }

    #[test]
    fn crossing_fires_once_when_the_threshold_is_passed() {
        let min = goal(GoalKind::Minimum, 2 * H);
        assert_eq!(crossing(&min, H, 2 * H), Some(EventKind::Reached));
        assert_eq!(crossing(&min, 2 * H, 3 * H), None);
        assert_eq!(crossing(&min, 0, H), None);
        let max = goal(GoalKind::Maximum, H);
        assert_eq!(crossing(&max, H, H + 1), Some(EventKind::Exceeded));
        assert_eq!(crossing(&max, H + 1, 2 * H), None);
    }

    #[test]
    fn time_until_the_next_crossing() {
        let min = goal(GoalKind::Minimum, 2 * H);
        assert_eq!(ms_until_crossing(&min, 30 * 60_000), Some(90 * 60_000));
        assert_eq!(ms_until_crossing(&min, 2 * H), None);
        let max = goal(GoalKind::Maximum, H);
        assert_eq!(ms_until_crossing(&max, H), Some(1));
        assert_eq!(ms_until_crossing(&max, 0), Some(H + 1));
        assert_eq!(ms_until_crossing(&max, H + 1), None);
    }

    #[test]
    fn rest_days_do_not_count_and_do_not_break_a_streak() {
        let history = closed(&[
            (96, Outcome::Met),
            (97, Outcome::Inactive),
            (98, Outcome::Inactive),
            (99, Outcome::Met),
        ]);
        let s = streak(
            &history,
            &open(GoalKind::Minimum, GoalState::Pending, false),
        );
        assert_eq!((s.current, s.best, s.start_day), (2, 2, Some(96)));
        assert!(!s.at_risk, "a rest day cannot put the streak at risk");
    }

    #[test]
    fn a_missed_active_day_resets_the_streak() {
        let history = closed(&[
            (95, Outcome::Met),
            (96, Outcome::Met),
            (97, Outcome::Met),
            (98, Outcome::Missed),
        ]);
        let s = streak(&history, &open(GoalKind::Minimum, GoalState::Pending, true));
        assert_eq!((s.current, s.best, s.start_day), (0, 3, None));
    }

    #[test]
    fn the_open_period_never_breaks_a_streak_but_flags_it_at_risk() {
        let history = closed(&[(98, Outcome::Met), (99, Outcome::Met)]);
        let pending = streak(&history, &open(GoalKind::Minimum, GoalState::Pending, true));
        assert_eq!((pending.current, pending.at_risk), (2, true));
        let reached = streak(&history, &open(GoalKind::Minimum, GoalState::Reached, true));
        assert_eq!(
            (reached.current, reached.best, reached.at_risk),
            (3, 3, false)
        );
    }

    #[test]
    fn a_maximum_counts_only_once_the_period_closes() {
        let history = closed(&[(99, Outcome::Met)]);
        let within = streak(&history, &open(GoalKind::Maximum, GoalState::Pending, true));
        assert_eq!((within.current, within.at_risk), (1, false));
        let over = streak(
            &history,
            &open(GoalKind::Maximum, GoalState::Exceeded, true),
        );
        assert_eq!((over.current, over.at_risk), (1, true));
    }

    #[test]
    fn a_reached_open_period_starts_a_new_run() {
        let history = closed(&[(98, Outcome::Missed)]);
        let s = streak(&history, &open(GoalKind::Minimum, GoalState::Reached, true));
        assert_eq!((s.current, s.start_day), (1, Some(100)));
    }

    #[test]
    fn validation_rejects_bad_goals() {
        let mut g = goal(GoalKind::Minimum, 2 * H);
        assert!(g.validate().is_ok());
        g.label = "  ".into();
        assert_eq!(g.validate(), Err(GoalError::EmptyLabel));
        g.label = "x".repeat(61);
        assert_eq!(g.validate(), Err(GoalError::LabelTooLong));
        g.label = "ok".into();
        g.target_ms = 25 * H;
        assert_eq!(g.validate(), Err(GoalError::InvalidTarget));
        g.target_ms = 0;
        assert_eq!(g.validate(), Err(GoalError::InvalidTarget));
        g.target_ms = H;
        g.active_days = 0;
        assert_eq!(g.validate(), Err(GoalError::InvalidDays));
        g.active_days = 0b1000_0000;
        assert_eq!(g.validate(), Err(GoalError::InvalidDays));
        g.active_days = ALL_DAYS;
        g.scope = GoalScope::App(" ".into());
        assert_eq!(g.validate(), Err(GoalError::EmptyApp));
    }

    #[test]
    fn scope_decides_what_counts() {
        let mut g = goal(GoalKind::Minimum, H);
        assert!(g.counts(ActivityId(2), Some("a")) && !g.counts(ActivityId(3), Some("a")));
        g.scope = GoalScope::App("a".into());
        assert!(g.counts(ActivityId(9), Some("a")) && !g.counts(ActivityId(9), Some("b")));
        assert!(!g.counts(ActivityId(9), None));
        g.scope = GoalScope::Total;
        assert!(g.counts(ActivityId(9), None));
    }

    #[test]
    fn only_daily_goals_honor_active_days() {
        let mut g = goal(GoalKind::Minimum, H);
        // Day 4 is a Monday, day 9 a Saturday.
        assert!(g.is_active_on(4) && !g.is_active_on(9));
        g.period = Period::Weekly;
        assert!(g.is_active_on(9));
    }

    #[test]
    fn a_purge_cuts_the_streak_days_before_the_cutoff() {
        assert_eq!(retention_cuts_streak(100, 80), Some(20));
        assert_eq!(retention_cuts_streak(100, 100), None);
        assert_eq!(retention_cuts_streak(100, 120), None);
    }

    proptest! {
        #[test]
        fn streak_invariants(
            outcomes in proptest::collection::vec(0u8..3, 0..60),
            state in 0u8..3,
        ) {
            let history: Vec<ClosedPeriod> = outcomes
                .iter()
                .enumerate()
                .map(|(i, o)| ClosedPeriod {
                    start_day: i as i64,
                    outcome: match o { 0 => Outcome::Met, 1 => Outcome::Missed, _ => Outcome::Inactive },
                })
                .collect();
            let st = match state { 0 => GoalState::Pending, 1 => GoalState::Reached, _ => GoalState::Exceeded };
            let s = streak(&history, &CurrentPeriod { start_day: 99, kind: GoalKind::Minimum, state: st, active: true });
            prop_assert!(s.current <= s.best);
            let met = history.iter().filter(|p| p.outcome == Outcome::Met).count() as u32 + 1;
            prop_assert!(s.best <= met);
            // Rest days never change the result.
            let without_rest: Vec<ClosedPeriod> =
                history.iter().copied().filter(|p| p.outcome != Outcome::Inactive).collect();
            let t = streak(&without_rest, &CurrentPeriod { start_day: 99, kind: GoalKind::Minimum, state: st, active: true });
            prop_assert_eq!((s.current, s.best), (t.current, t.best));
        }
    }
}
