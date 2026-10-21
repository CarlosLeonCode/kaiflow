//! Goals use cases: validated CRUD, the progress shown everywhere (`statuses`), and the
//! evaluation the goal watcher runs to announce threshold crossings.
//!
//! Every figure comes from one load of the segments of the periods involved: the current
//! period of each goal, plus (for streaks) the closed periods since the goal was created, at
//! most [`STREAK_LOOKBACK_DAYS`] back. Totals are cut at period boundaries in one pass, so
//! the cost does not grow with the number of goals.

use std::collections::HashMap;
use std::sync::Arc;

use domain::calendar::{next_period_start, period_start};
use domain::goals::{
    ClosedPeriod, CurrentPeriod, EventKind, Goal, GoalKind, GoalScope, GoalState, Outcome, Streak,
    is_met, ms_until_crossing, progress, retention_cuts_streak, streak,
};
use domain::{Activity, ActivityId, Period, UNASSIGNED, UtcMs};

use crate::commands::{CommandError, StreakImpact};
use crate::dashboard::resolve;
use crate::ports::{
    ActivityRepository, Calendar, GoalEvent, GoalRepository, PortError, PortResult,
    ReportRepository, SettingsRepository,
};
use crate::settings_blobs::read_week_start;

/// How far back streaks look; older periods are ignored (a streak never reads more than this).
pub const STREAK_LOOKBACK_DAYS: i64 = 180;

/// Progress of one goal in its current period, with its streak.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoalStatus {
    pub goal: Goal,
    /// First local day of the current period and the day after its last (day numbers).
    pub period_start_day: i64,
    pub period_end_day: i64,
    /// The same period as a UTC range `[from, to)`.
    pub from: UtcMs,
    pub to: UtcMs,
    pub actual_ms: i64,
    pub target_ms: i64,
    /// `actual / target` in whole percent; may pass 100.
    pub percent: u32,
    pub state: GoalState,
    /// `false` on a rest day of a daily goal: it shows progress but is not evaluated.
    pub active: bool,
    pub streak: Streak,
    /// A threshold crossed in this period that the user has not acknowledged yet.
    pub unseen: Option<EventKind>,
}

/// How one period of a goal ended up inside a reviewed week.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WeekResult {
    Met,
    Missed,
    /// A rest day of a daily goal, or a period from before the goal existed.
    Inactive,
    /// Still open and not decided yet.
    InProgress,
}

impl WeekResult {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Met => "met",
            Self::Missed => "missed",
            Self::Inactive => "inactive",
            Self::InProgress => "in_progress",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoalWeekPeriod {
    pub start_day: i64,
    pub actual_ms: i64,
    pub result: WeekResult,
}

/// A goal seen through one reviewed week: the periods that touch it, and its streak as of now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoalWeek {
    pub goal: Goal,
    /// Daily goals: one entry per day of the week. Weekly and monthly goals: the period that
    /// contains the first day of the week (its total may cover more than the week).
    pub periods: Vec<GoalWeekPeriod>,
    pub current_streak: u32,
    pub best_streak: u32,
}

impl GoalWeek {
    pub fn met(&self) -> usize {
        self.count(WeekResult::Met)
    }

    pub fn missed(&self) -> usize {
        self.count(WeekResult::Missed)
    }

    fn count(&self, result: WeekResult) -> usize {
        self.periods.iter().filter(|p| p.result == result).count()
    }
}

/// A threshold that was just crossed for the first time in its period.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Crossing {
    pub goal: Goal,
    pub kind: EventKind,
}

/// What the watcher needs after looking at the goals.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Evaluation {
    /// New crossings, already stored in the event log (so each is announced once).
    pub crossings: Vec<Crossing>,
    /// Tracked time until the nearest threshold, assuming time keeps being tracked towards it.
    pub next_crossing_ms: Option<i64>,
    /// Time until the next local midnight, when daily periods roll over.
    pub until_midnight_ms: i64,
}

/// The goal the tray shows: its total so far and its target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayGoal {
    pub label: String,
    pub actual_ms: i64,
    pub target_ms: i64,
}

pub struct GoalService {
    goals: Arc<dyn GoalRepository>,
    reports: Arc<dyn ReportRepository>,
    activities: Arc<dyn ActivityRepository>,
    settings: Arc<dyn SettingsRepository>,
    calendar: Arc<dyn Calendar>,
}

/// Period boundaries of one kind: `starts[i]` is the first local day of period `i`,
/// `bounds[i]..bounds[i + 1]` its UTC range. The last period is the current one.
struct Table {
    starts: Vec<i64>,
    bounds: Vec<UtcMs>,
}

impl Table {
    fn current(&self) -> usize {
        self.starts.len() - 1
    }
}

/// Per goal: its table and a total per period of that table.
struct Totals {
    period: Period,
    totals: Vec<i64>,
}

impl GoalService {
    pub fn new(
        goals: Arc<dyn GoalRepository>,
        reports: Arc<dyn ReportRepository>,
        activities: Arc<dyn ActivityRepository>,
        settings: Arc<dyn SettingsRepository>,
        calendar: Arc<dyn Calendar>,
    ) -> Self {
        Self {
            goals,
            reports,
            activities,
            settings,
            calendar,
        }
    }

    /// Every goal, archived ones included.
    pub fn list(&self) -> Result<Vec<Goal>, CommandError> {
        Ok(self.goals.list()?)
    }

    /// Creates (`goal.id <= 0`) or updates a goal. The goal's events for the current period
    /// are reset and the state it is already in is recorded silently, so saving a goal that
    /// is already reached never announces anything.
    pub fn save(&self, goal: Goal, now: UtcMs) -> Result<Goal, CommandError> {
        let mut goal = Goal {
            label: goal.label.trim().to_owned(),
            created_at: if goal.id > 0 { goal.created_at } else { now },
            ..goal
        };
        if let GoalScope::App(app) = &mut goal.scope {
            *app = app.trim().to_owned();
        }
        goal.validate()
            .map_err(|e| CommandError::Invalid(e.to_string()))?;
        if let GoalScope::Activity(id) = goal.scope
            && id != UNASSIGNED
            && !self.activities.list()?.iter().any(|a| a.id == id)
        {
            return Err(CommandError::Invalid("that activity does not exist".into()));
        }
        if goal.id > 0 && !self.goals.list()?.iter().any(|g| g.id == goal.id) {
            return Err(CommandError::NotFound);
        }
        let saved = self.goals.save(&goal)?;
        if !saved.archived {
            self.baseline(&saved, now)?;
        }
        Ok(saved)
    }

    pub fn delete(&self, id: i64) -> Result<(), CommandError> {
        Ok(self.goals.delete(id)?)
    }

    /// The user acknowledged the badge of a goal.
    pub fn mark_seen(&self, goal_id: i64) -> Result<(), CommandError> {
        Ok(self.goals.mark_seen(goal_id)?)
    }

    /// Progress and streak of every goal that is not archived: the one query popover, Today
    /// and Overview share.
    pub fn statuses(&self, now: UtcMs) -> Result<Vec<GoalStatus>, CommandError> {
        let goals = self.live_goals()?;
        if goals.is_empty() {
            return Ok(Vec::new());
        }
        let week_start = read_week_start(self.settings.as_ref())?;
        let today = self.calendar.local_day(now);
        let tables = self.tables(&goals, today, week_start, true);
        let totals = self.totals(&goals, &tables, now)?;
        let unseen = self.goals.unseen_events()?;

        Ok(goals
            .into_iter()
            .zip(totals)
            .map(|(goal, totals)| {
                let table = &tables[&totals.period];
                let (current, closed) =
                    (table.current(), self.closed_periods(&goal, table, &totals));
                let status = self.status_of(&goal, table, current, totals.totals[current], &closed);
                let unseen = unseen
                    .iter()
                    .find(|e| e.goal_id == goal.id && e.period_start_day == status.period_start_day)
                    .map(|e| e.kind);
                GoalStatus { unseen, ..status }
            })
            .collect())
    }

    /// How every live goal fared in the week that starts on local day `week_start_day`: one
    /// load of the segments of the week (plus the enclosing weekly / monthly periods), the
    /// streaks as of `now`. Goals created after the week are left out.
    pub fn week_outcomes(
        &self,
        week_start_day: i64,
        now: UtcMs,
    ) -> Result<Vec<GoalWeek>, CommandError> {
        let week_end_day = week_start_day + 7;
        let goals: Vec<Goal> = self
            .live_goals()?
            .into_iter()
            .filter(|g| self.calendar.local_day(g.created_at) < week_end_day)
            .collect();
        if goals.is_empty() {
            return Ok(Vec::new());
        }
        let week_start = read_week_start(self.settings.as_ref())?;
        let today = self.calendar.local_day(now);

        let mut tables = HashMap::new();
        for period in Period::ALL {
            if !goals.iter().any(|g| g.period == period) {
                continue;
            }
            let starts: Vec<i64> = match period {
                Period::Daily => (week_start_day..week_end_day).collect(),
                _ => vec![period_start(period, week_start_day, week_start)],
            };
            let mut bounds: Vec<UtcMs> = starts
                .iter()
                .map(|d| self.calendar.start_of_day(*d))
                .collect();
            let last = starts[starts.len() - 1];
            bounds.push(self.calendar.start_of_day(next_period_start(period, last)));
            tables.insert(period, Table { starts, bounds });
        }
        let totals = self.totals(&goals, &tables, now)?;
        let streaks: HashMap<i64, Streak> = self
            .statuses(now)?
            .into_iter()
            .map(|s| (s.goal.id, s.streak))
            .collect();

        Ok(goals
            .into_iter()
            .zip(totals)
            .map(|(goal, totals)| {
                let table = &tables[&totals.period];
                let created_day = self.calendar.local_day(goal.created_at);
                let periods = table
                    .starts
                    .iter()
                    .zip(&totals.totals)
                    .map(|(start, actual)| {
                        let end = next_period_start(goal.period, *start);
                        let result = if end <= created_day || !goal.is_active_on(*start) {
                            WeekResult::Inactive
                        } else if end <= today {
                            if is_met(&goal, *actual) {
                                WeekResult::Met
                            } else {
                                WeekResult::Missed
                            }
                        } else {
                            match (goal.kind, is_met(&goal, *actual)) {
                                (GoalKind::Minimum, true) => WeekResult::Met,
                                (GoalKind::Maximum, false) => WeekResult::Missed,
                                _ => WeekResult::InProgress,
                            }
                        };
                        GoalWeekPeriod {
                            start_day: *start,
                            actual_ms: *actual,
                            result,
                        }
                    })
                    .collect();
                let streak = streaks.get(&goal.id).copied().unwrap_or_default();
                GoalWeek {
                    goal,
                    periods,
                    current_streak: streak.current,
                    best_streak: streak.best,
                }
            })
            .collect())
    }

    /// Stores the thresholds crossed so far in the current periods and reports the new ones.
    /// Rest days are skipped. Each (goal, period, kind) is returned once, ever.
    pub fn evaluate(&self, now: UtcMs) -> Result<Evaluation, CommandError> {
        let goals = self.live_goals()?;
        let week_start = read_week_start(self.settings.as_ref())?;
        let today = self.calendar.local_day(now);
        let until_midnight_ms = self.calendar.start_of_day(today + 1).since(now).max(0);
        let tables = self.tables(&goals, today, week_start, false);
        let totals = self.totals(&goals, &tables, now)?;

        let mut crossings = Vec::new();
        let mut next_crossing_ms: Option<i64> = None;
        for (goal, totals) in goals.into_iter().zip(totals) {
            let table = &tables[&totals.period];
            let current = table.current();
            if !goal.is_active_on(table.starts[current]) {
                continue;
            }
            let actual = totals.totals[current];
            let kind = match progress(&goal, actual).state {
                GoalState::Reached => Some(EventKind::Reached),
                GoalState::Exceeded => Some(EventKind::Exceeded),
                GoalState::Pending => None,
            };
            match kind {
                Some(kind) => {
                    let event = GoalEvent {
                        goal_id: goal.id,
                        period_start_day: table.starts[current],
                        kind,
                        at: now,
                        notified: true,
                        seen: false,
                    };
                    if self.goals.record_event(&event)? {
                        crossings.push(Crossing { goal, kind });
                    }
                }
                None => {
                    if let Some(ms) = ms_until_crossing(&goal, actual) {
                        next_crossing_ms = Some(next_crossing_ms.map_or(ms, |m| m.min(ms)));
                    }
                }
            }
        }
        Ok(Evaluation {
            crossings,
            next_crossing_ms,
            until_midnight_ms,
        })
    }

    /// The goal the tray shows: the first one still in progress today, else the first one
    /// that applies today; `None` without goals.
    pub fn tray_goal(&self, now: UtcMs) -> Result<Option<TrayGoal>, CommandError> {
        let goals = self.live_goals()?;
        if goals.is_empty() {
            return Ok(None);
        }
        let week_start = read_week_start(self.settings.as_ref())?;
        let today = self.calendar.local_day(now);
        let tables = self.tables(&goals, today, week_start, false);
        let totals = self.totals(&goals, &tables, now)?;
        let rows: Vec<(Goal, i64, bool)> = goals
            .into_iter()
            .zip(totals)
            .map(|(goal, totals)| {
                let table = &tables[&totals.period];
                let current = table.current();
                let active = goal.is_active_on(table.starts[current]);
                (goal, totals.totals[current], active)
            })
            .collect();
        let pick = rows
            .iter()
            .find(|(g, actual, active)| *active && progress(g, *actual).state == GoalState::Pending)
            .or_else(|| rows.iter().find(|(_, _, active)| *active));
        Ok(pick.map(|(goal, actual_ms, _)| TrayGoal {
            label: goal.label.clone(),
            actual_ms: *actual_ms,
            target_ms: goal.target_ms,
        }))
    }

    fn live_goals(&self) -> PortResult<Vec<Goal>> {
        Ok(self
            .goals
            .list()?
            .into_iter()
            .filter(|g| !g.archived)
            .collect())
    }

    /// Resets the current period's events and records the state the goal is already in.
    fn baseline(&self, goal: &Goal, now: UtcMs) -> Result<(), CommandError> {
        let week_start = read_week_start(self.settings.as_ref())?;
        let today = self.calendar.local_day(now);
        let one = std::slice::from_ref(goal);
        let tables = self.tables(one, today, week_start, false);
        let totals = self.totals(one, &tables, now)?;
        let table = &tables[&goal.period];
        let current = table.current();
        let day = table.starts[current];
        self.goals.clear_events(goal.id, day)?;
        let kind = match progress(goal, totals[0].totals[current]).state {
            GoalState::Reached => Some(EventKind::Reached),
            GoalState::Exceeded => Some(EventKind::Exceeded),
            GoalState::Pending => None,
        };
        if let Some(kind) = kind {
            self.goals.record_event(&GoalEvent {
                goal_id: goal.id,
                period_start_day: day,
                kind,
                at: now,
                notified: true,
                seen: true,
            })?;
        }
        Ok(())
    }

    /// One table per period kind in use. With `history` the table reaches back to the oldest
    /// creation period among its goals (never beyond the lookback); without it only the
    /// current period is there.
    fn tables(
        &self,
        goals: &[Goal],
        today: i64,
        week_start: u8,
        history: bool,
    ) -> HashMap<Period, Table> {
        let mut tables = HashMap::new();
        for period in Period::ALL {
            let mine: Vec<&Goal> = goals.iter().filter(|g| g.period == period).collect();
            if mine.is_empty() {
                continue;
            }
            let current = period_start(period, today, week_start);
            let first = if history {
                let floor = period_start(period, today - STREAK_LOOKBACK_DAYS, week_start);
                let oldest = mine
                    .iter()
                    .map(|g| {
                        period_start(period, self.calendar.local_day(g.created_at), week_start)
                    })
                    .min()
                    .unwrap_or(current);
                oldest.max(floor).min(current)
            } else {
                current
            };
            let mut starts = vec![first];
            while *starts.last().unwrap_or(&first) < current {
                let last = *starts.last().unwrap_or(&first);
                starts.push(next_period_start(period, last));
            }
            let mut bounds: Vec<UtcMs> = starts
                .iter()
                .map(|d| self.calendar.start_of_day(*d))
                .collect();
            bounds.push(
                self.calendar
                    .start_of_day(next_period_start(period, current)),
            );
            tables.insert(period, Table { starts, bounds });
        }
        tables
    }

    /// Total per period for every goal (same order as `goals`), from one load.
    fn totals(
        &self,
        goals: &[Goal],
        tables: &HashMap<Period, Table>,
        now: UtcMs,
    ) -> Result<Vec<Totals>, CommandError> {
        let mut out: Vec<Totals> = goals
            .iter()
            .map(|g| Totals {
                period: g.period,
                totals: vec![0; tables[&g.period].starts.len()],
            })
            .collect();
        let Some(from) = tables.values().map(|t| t.bounds[0]).min() else {
            return Ok(out);
        };
        let to = tables
            .values()
            .map(|t| t.bounds[t.bounds.len() - 1])
            .max()
            .unwrap_or(from);

        let rules = self.activities.list_rules()?;
        let activities = self.activities.list()?;
        let known: HashMap<ActivityId, &Activity> = activities.iter().map(|a| (a.id, a)).collect();
        let segments = self.reports.segments_in_range(from, to)?;
        let mut memo = HashMap::new();
        for segment in &segments {
            let end = segment.ended_at.unwrap_or(now);
            let start = segment.started_at;
            if end <= start {
                continue;
            }
            let activity = resolve(segment, &rules, &known, &mut memo);
            for (goal, totals) in goals.iter().zip(&mut out) {
                if !goal.counts(activity, segment.app_id.as_deref()) {
                    continue;
                }
                let bounds = &tables[&goal.period].bounds;
                // The period `start` falls in (the first one when it begins before the table).
                let mut i = bounds.partition_point(|b| *b <= start).saturating_sub(1);
                while i + 1 < bounds.len() && bounds[i] < end {
                    let overlap = end.min(bounds[i + 1]).since(start.max(bounds[i]));
                    if overlap > 0 {
                        totals.totals[i] += overlap;
                    }
                    i += 1;
                }
            }
        }
        Ok(out)
    }

    /// Outcome of every closed period of the table (the current one excluded).
    fn closed_periods(&self, goal: &Goal, table: &Table, totals: &Totals) -> Vec<ClosedPeriod> {
        table.starts[..table.current()]
            .iter()
            .zip(&totals.totals)
            .map(|(start, total)| ClosedPeriod {
                start_day: *start,
                outcome: if !goal.is_active_on(*start) {
                    Outcome::Inactive
                } else if is_met(goal, *total) {
                    Outcome::Met
                } else {
                    Outcome::Missed
                },
            })
            .collect()
    }

    fn status_of(
        &self,
        goal: &Goal,
        table: &Table,
        current: usize,
        actual_ms: i64,
        closed: &[ClosedPeriod],
    ) -> GoalStatus {
        let p = progress(goal, actual_ms);
        let start_day = table.starts[current];
        let active = goal.is_active_on(start_day);
        let streak = streak(
            closed,
            &CurrentPeriod {
                start_day,
                kind: goal.kind,
                state: p.state,
                active,
            },
        );
        GoalStatus {
            goal: goal.clone(),
            period_start_day: start_day,
            period_end_day: next_period_start(goal.period, start_day),
            from: table.bounds[current],
            to: table.bounds[current + 1],
            actual_ms: p.actual_ms,
            target_ms: p.target_ms,
            percent: p.percent,
            state: p.state,
            active,
            streak,
            unseen: None,
        }
    }
}

impl StreakImpact for GoalService {
    fn streak_days_cut(&self, cutoff: UtcMs, now: UtcMs) -> Result<Option<u32>, PortError> {
        let cutoff_day = self.calendar.local_day(cutoff);
        let statuses = self.statuses(now).map_err(|e| PortError(e.to_string()))?;
        Ok(statuses
            .iter()
            .filter(|s| s.streak.current > 0)
            .filter_map(|s| s.streak.start_day)
            .filter_map(|start| retention_cuts_streak(cutoff_day, start))
            .max())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fakes::{FakeActivities, FakeGoals, FakeSettings, FakeStore, FixedCalendar};
    use domain::{EndReason, Segment, SegmentId, SegmentSource};

    const MIN: i64 = 60_000;
    const HOUR: i64 = 60 * MIN;
    const DAY: i64 = 24 * HOUR;
    /// Day 100 (1970-04-11) is a Saturday; day 98 is Thursday, day 102 Monday.
    const D0: i64 = 100 * DAY;

    struct Rig {
        service: GoalService,
        store: FakeStore,
        goals: FakeGoals,
        settings: FakeSettings,
        activities: FakeActivities,
    }

    fn rig_with(calendar: FixedCalendar) -> Rig {
        let store = FakeStore::default();
        let goals = FakeGoals::default();
        let settings = FakeSettings::default();
        let activities = FakeActivities::default();
        activities
            .create("Deep work", "#111", domain::Productivity::Productive)
            .unwrap();
        let service = GoalService::new(
            Arc::new(goals.clone()),
            Arc::new(store.clone()),
            Arc::new(activities.clone()),
            Arc::new(settings.clone()),
            Arc::new(calendar),
        );
        Rig {
            service,
            store,
            goals,
            settings,
            activities,
        }
    }

    fn rig() -> Rig {
        rig_with(FixedCalendar::fixed(0))
    }

    fn spend(store: &FakeStore, app: &str, start: i64, end: i64) {
        store.seed_segment(Segment {
            id: SegmentId(0),
            started_at: UtcMs(start),
            ended_at: Some(UtcMs(end)),
            heartbeat_at: UtcMs(end),
            app_id: Some(app.into()),
            app_name: Some(app.into()),
            window_title: None,
            end_reason: Some(EndReason::FocusChange),
            source: SegmentSource::Tracked,
            activity_id: None,
        });
    }

    fn goal(scope: GoalScope, period: Period, kind: GoalKind, target_ms: i64) -> Goal {
        Goal {
            id: 0,
            label: "Goal".into(),
            scope,
            period,
            kind,
            target_ms,
            active_days: domain::calendar::ALL_DAYS,
            archived: false,
            created_at: UtcMs(0),
        }
    }

    fn total_goal(period: Period, kind: GoalKind, target_ms: i64) -> Goal {
        goal(GoalScope::Total, period, kind, target_ms)
    }

    #[test]
    fn a_goal_is_validated_and_stamped_with_its_creation_time() {
        let r = rig();
        let bad = total_goal(Period::Daily, GoalKind::Minimum, 0);
        assert!(matches!(
            r.service.save(bad, UtcMs(D0)),
            Err(CommandError::Invalid(_))
        ));
        let missing = goal(
            GoalScope::Activity(ActivityId(77)),
            Period::Daily,
            GoalKind::Minimum,
            HOUR,
        );
        assert!(matches!(
            r.service.save(missing, UtcMs(D0)),
            Err(CommandError::Invalid(_))
        ));
        let mut ghost = total_goal(Period::Daily, GoalKind::Minimum, HOUR);
        ghost.id = 9;
        assert_eq!(
            r.service.save(ghost, UtcMs(D0)),
            Err(CommandError::NotFound)
        );

        let saved = r
            .service
            .save(
                total_goal(Period::Daily, GoalKind::Minimum, HOUR),
                UtcMs(D0 + 5),
            )
            .unwrap();
        assert_eq!((saved.id, saved.created_at), (1, UtcMs(D0 + 5)));
    }

    #[test]
    fn a_daily_minimum_is_met_when_the_activity_reaches_two_hours() {
        let r = rig();
        // The fake has no system activity, so its first activity takes id 1 (Unassigned).
        let work = r
            .activities
            .create("Writing", "#222", domain::Productivity::Productive)
            .unwrap()
            .id;
        r.service
            .save(
                goal(
                    GoalScope::Activity(work),
                    Period::Daily,
                    GoalKind::Minimum,
                    2 * HOUR,
                ),
                UtcMs(D0),
            )
            .unwrap();
        r.activities
            .save_rule(&domain::ActivityRule {
                id: 0,
                activity_id: work,
                kind: domain::RuleKind::App("code".into()),
                priority: 0,
            })
            .unwrap();
        // Day 100, 09:00 to 10:30 in the app, plus 30 minutes in another app.
        spend(&r.store, "code", D0 + 9 * HOUR, D0 + 10 * HOUR + 30 * MIN);
        spend(&r.store, "mail", D0 + 11 * HOUR, D0 + 11 * HOUR + 30 * MIN);

        let at = |ms: i64| r.service.statuses(UtcMs(D0 + ms)).unwrap().remove(0);
        let before = at(12 * HOUR);
        assert_eq!(
            (before.actual_ms, before.state, before.percent),
            (90 * MIN, GoalState::Pending, 75)
        );
        spend(&r.store, "code", D0 + 13 * HOUR, D0 + 13 * HOUR + 30 * MIN);
        let after = at(14 * HOUR);
        assert_eq!(
            (after.actual_ms, after.state),
            (2 * HOUR, GoalState::Reached)
        );
        assert_eq!(after.streak.current, 1);
        assert!(!after.streak.at_risk);
    }

    #[test]
    fn app_and_total_scopes_count_what_they_target() {
        let r = rig();
        r.service
            .save(
                goal(
                    GoalScope::App("mail".into()),
                    Period::Daily,
                    GoalKind::Maximum,
                    HOUR,
                ),
                UtcMs(D0),
            )
            .unwrap();
        r.service
            .save(
                total_goal(Period::Daily, GoalKind::Minimum, 4 * HOUR),
                UtcMs(D0),
            )
            .unwrap();
        spend(&r.store, "mail", D0 + 9 * HOUR, D0 + 10 * HOUR);
        spend(&r.store, "code", D0 + 10 * HOUR, D0 + 12 * HOUR);
        let statuses = r.service.statuses(UtcMs(D0 + 13 * HOUR)).unwrap();
        assert_eq!(statuses[0].actual_ms, HOUR);
        assert_eq!(statuses[1].actual_ms, 3 * HOUR);
    }

    #[test]
    fn rest_days_do_not_count_or_break_the_streak_and_a_missed_active_day_resets_it() {
        let r = rig();
        let mut weekdays = total_goal(Period::Daily, GoalKind::Minimum, HOUR);
        weekdays.active_days = 0b001_1111; // Monday to Friday
        // Created on day 94 (a Sunday) so the earlier days are not part of its history.
        r.service.save(weekdays, UtcMs(94 * DAY)).unwrap();
        // Days 95..=99 are Monday to Friday? 98 is Thursday, 99 Friday, 100 Saturday, 101 Sunday.
        for day in [95, 96, 97, 98, 99] {
            spend(
                &r.store,
                "code",
                day * DAY + 9 * HOUR,
                day * DAY + 10 * HOUR,
            );
        }
        // Weekend (100, 101) has no time; today is Monday 102, nothing yet.
        let today = UtcMs(102 * DAY + 8 * HOUR);
        let s = r.service.statuses(today).unwrap().remove(0);
        assert_eq!(s.streak.current, 5, "the weekend neither counts nor breaks");
        assert_eq!(s.streak.best, 5);
        assert!(
            s.streak.at_risk,
            "today is an active day still short of the target"
        );
        assert_eq!(s.streak.start_day, Some(95));

        // Tuesday 103 is missed entirely: by Wednesday the streak is back to 0, Monday met.
        spend(
            &r.store,
            "code",
            102 * DAY + 9 * HOUR,
            102 * DAY + 10 * HOUR,
        );
        let wednesday = UtcMs(104 * DAY + 8 * HOUR);
        let s = r.service.statuses(wednesday).unwrap().remove(0);
        assert_eq!((s.streak.current, s.streak.best), (0, 6));
    }

    #[test]
    fn a_rest_day_is_not_active_and_a_maximum_counts_when_the_period_closes() {
        let r = rig();
        let mut g = total_goal(Period::Daily, GoalKind::Maximum, HOUR);
        g.active_days = 0b001_1111;
        r.service.save(g, UtcMs(98 * DAY)).unwrap();
        spend(&r.store, "mail", 98 * DAY + HOUR, 98 * DAY + 2 * HOUR); // exactly at the limit: met
        spend(&r.store, "mail", 99 * DAY + HOUR, 99 * DAY + 3 * HOUR); // over: missed
        let saturday = r
            .service
            .statuses(UtcMs(100 * DAY + HOUR))
            .unwrap()
            .remove(0);
        assert!(!saturday.active);
        assert_eq!((saturday.streak.current, saturday.streak.best), (0, 1));
    }

    #[test]
    fn weekly_goals_follow_the_configured_week_start() {
        let r = rig();
        r.service
            .save(
                total_goal(Period::Weekly, GoalKind::Minimum, 10 * HOUR),
                UtcMs(D0),
            )
            .unwrap();
        // Sunday 101 holds 3 hours; Monday 102 holds 2.
        spend(
            &r.store,
            "code",
            101 * DAY + 9 * HOUR,
            101 * DAY + 12 * HOUR,
        );
        spend(
            &r.store,
            "code",
            102 * DAY + 9 * HOUR,
            102 * DAY + 11 * HOUR,
        );
        let now = UtcMs(103 * DAY);
        // Monday-first: the week of Monday 102 only has Monday's 2 hours.
        let monday = r.service.statuses(now).unwrap().remove(0);
        assert_eq!((monday.period_start_day, monday.actual_ms), (102, 2 * HOUR));
        // Sunday-first: Sunday 101 opens the week, so both days count.
        r.settings.set("week_start", "6").unwrap();
        let sunday = r.service.statuses(now).unwrap().remove(0);
        assert_eq!((sunday.period_start_day, sunday.period_end_day), (101, 108));
        assert_eq!(sunday.actual_ms, 5 * HOUR);
    }

    #[test]
    fn monthly_goals_cover_the_calendar_month() {
        let r = rig();
        r.service
            .save(
                total_goal(Period::Monthly, GoalKind::Minimum, 5 * HOUR),
                UtcMs(D0),
            )
            .unwrap();
        // April 1970 starts on day 90 and ends before day 120.
        spend(&r.store, "code", 90 * DAY + HOUR, 90 * DAY + 3 * HOUR);
        spend(&r.store, "code", 119 * DAY + HOUR, 119 * DAY + 2 * HOUR);
        spend(&r.store, "code", 120 * DAY + HOUR, 120 * DAY + 2 * HOUR); // May
        let s = r
            .service
            .statuses(UtcMs(119 * DAY + 5 * HOUR))
            .unwrap()
            .remove(0);
        assert_eq!((s.period_start_day, s.period_end_day), (90, 120));
        assert_eq!(s.actual_ms, 3 * HOUR);
    }

    #[test]
    fn local_midnight_decides_the_day_and_time_across_it_is_shared() {
        // UTC+2: local midnight is 22:00 UTC the day before.
        let r = rig_with(FixedCalendar::fixed(2 * HOUR));
        r.service
            .save(
                total_goal(Period::Daily, GoalKind::Minimum, 2 * HOUR),
                UtcMs(D0),
            )
            .unwrap();
        // 21:00 to 23:00 UTC = 23:00 to 01:00 local: one hour on each side of midnight.
        spend(&r.store, "code", D0 + 21 * HOUR, D0 + 23 * HOUR);
        let late = r
            .service
            .statuses(UtcMs(D0 + 23 * HOUR + 30 * MIN))
            .unwrap()
            .remove(0);
        // Local day 101 started at 22:00 UTC on day 100.
        assert_eq!((late.period_start_day, late.actual_ms), (101, HOUR));
        // The hour before midnight belongs to local day 100, which closed short of 2 hours.
        assert_eq!((late.streak.current, late.streak.best), (0, 0));
    }

    #[test]
    fn crossing_a_maximum_notifies_once_per_period_and_again_the_next_day() {
        let r = rig();
        r.service
            .save(
                goal(
                    GoalScope::App("mail".into()),
                    Period::Daily,
                    GoalKind::Maximum,
                    HOUR,
                ),
                UtcMs(D0),
            )
            .unwrap();
        spend(&r.store, "mail", D0 + 9 * HOUR, D0 + 9 * HOUR + 50 * MIN);
        let first = r.service.evaluate(UtcMs(D0 + 10 * HOUR)).unwrap();
        assert!(first.crossings.is_empty());
        assert_eq!(first.next_crossing_ms, Some(10 * MIN + 1));
        assert_eq!(first.until_midnight_ms, 14 * HOUR);

        spend(&r.store, "mail", D0 + 10 * HOUR, D0 + 10 * HOUR + 20 * MIN);
        let crossed = r.service.evaluate(UtcMs(D0 + 11 * HOUR)).unwrap();
        assert_eq!(crossed.crossings.len(), 1);
        assert_eq!(crossed.crossings[0].kind, EventKind::Exceeded);
        assert_eq!(crossed.next_crossing_ms, None);

        // Still using mail: no second notification the same day.
        spend(&r.store, "mail", D0 + 12 * HOUR, D0 + 13 * HOUR);
        assert!(
            r.service
                .evaluate(UtcMs(D0 + 14 * HOUR))
                .unwrap()
                .crossings
                .is_empty()
        );

        // Midnight resets the progress and the notification can fire again.
        spend(&r.store, "mail", D0 + DAY + HOUR, D0 + DAY + 3 * HOUR);
        let next_day = r.service.evaluate(UtcMs(D0 + DAY + 4 * HOUR)).unwrap();
        assert_eq!(next_day.crossings.len(), 1);
        assert_eq!(r.goals.events().len(), 2);
    }

    #[test]
    fn rest_days_never_notify() {
        let r = rig();
        let mut g = total_goal(Period::Daily, GoalKind::Maximum, HOUR);
        g.active_days = 0b001_1111;
        r.service.save(g, UtcMs(D0)).unwrap();
        // Day 100 is a Saturday.
        spend(&r.store, "mail", D0 + HOUR, D0 + 4 * HOUR);
        assert!(
            r.service
                .evaluate(UtcMs(D0 + 5 * HOUR))
                .unwrap()
                .crossings
                .is_empty()
        );
    }

    #[test]
    fn a_goal_already_reached_when_saved_is_not_announced() {
        let r = rig();
        spend(&r.store, "code", D0 + HOUR, D0 + 4 * HOUR);
        let now = UtcMs(D0 + 5 * HOUR);
        let saved = r
            .service
            .save(total_goal(Period::Daily, GoalKind::Minimum, 2 * HOUR), now)
            .unwrap();
        assert!(r.service.evaluate(now).unwrap().crossings.is_empty());
        let s = r.service.statuses(now).unwrap().remove(0);
        assert_eq!((s.state, s.unseen), (GoalState::Reached, None));

        // Raising the target resets the period: reaching the new one is announced.
        let mut raised = saved;
        raised.target_ms = 6 * HOUR;
        r.service.save(raised, now).unwrap();
        spend(&r.store, "code", D0 + 6 * HOUR, D0 + 9 * HOUR);
        assert_eq!(
            r.service
                .evaluate(UtcMs(D0 + 10 * HOUR))
                .unwrap()
                .crossings
                .len(),
            1
        );
    }

    #[test]
    fn an_unseen_crossing_shows_as_a_badge_until_marked_seen() {
        let r = rig();
        let g = r
            .service
            .save(
                total_goal(Period::Daily, GoalKind::Maximum, HOUR),
                UtcMs(D0),
            )
            .unwrap();
        spend(&r.store, "mail", D0 + HOUR, D0 + 3 * HOUR);
        let now = UtcMs(D0 + 4 * HOUR);
        r.service.evaluate(now).unwrap();
        let s = r.service.statuses(now).unwrap().remove(0);
        assert_eq!(s.unseen, Some(EventKind::Exceeded));
        r.service.mark_seen(g.id).unwrap();
        assert_eq!(r.service.statuses(now).unwrap()[0].unseen, None);
        // Tomorrow's badge is about a different period.
        assert_eq!(
            r.service.statuses(UtcMs(D0 + DAY + HOUR)).unwrap()[0].unseen,
            None
        );
    }

    #[test]
    fn archived_goals_are_neither_shown_nor_announced() {
        let r = rig();
        let mut g = total_goal(Period::Daily, GoalKind::Maximum, HOUR);
        g.archived = true;
        r.service.save(g, UtcMs(D0)).unwrap();
        spend(&r.store, "mail", D0 + HOUR, D0 + 4 * HOUR);
        let now = UtcMs(D0 + 5 * HOUR);
        assert!(r.service.statuses(now).unwrap().is_empty());
        assert!(r.service.evaluate(now).unwrap().crossings.is_empty());
        assert_eq!(r.service.list().unwrap().len(), 1);
    }

    #[test]
    fn all_goals_are_answered_with_one_load_of_segments() {
        let r = rig();
        for kind in [GoalKind::Minimum, GoalKind::Maximum] {
            for period in Period::ALL {
                r.service
                    .save(total_goal(period, kind, 3 * HOUR), UtcMs(90 * DAY))
                    .unwrap();
            }
        }
        spend(&r.store, "code", D0 + HOUR, D0 + 2 * HOUR);
        let before = r.store.range_loads();
        let statuses = r.service.statuses(UtcMs(D0 + 3 * HOUR)).unwrap();
        assert_eq!(statuses.len(), 6);
        assert_eq!(r.store.range_loads() - before, 1);
    }

    #[test]
    fn streaks_stop_at_the_goal_creation_and_at_the_lookback() {
        let r = rig();
        // Created today: history before it is not evaluated, so no phantom misses.
        r.service
            .save(
                total_goal(Period::Daily, GoalKind::Maximum, HOUR),
                UtcMs(D0 + HOUR),
            )
            .unwrap();
        let s = r.service.statuses(UtcMs(D0 + 2 * HOUR)).unwrap().remove(0);
        assert_eq!((s.streak.current, s.streak.best), (0, 0));
        // A goal from a year ago only reads the lookback window.
        let old = r
            .service
            .save(total_goal(Period::Daily, GoalKind::Maximum, HOUR), UtcMs(0))
            .unwrap();
        assert_eq!(old.created_at, UtcMs(0));
        let statuses = r.service.statuses(UtcMs(400 * DAY)).unwrap();
        let s = statuses.iter().find(|s| s.goal.id == old.id).unwrap();
        assert_eq!(s.streak.best as i64, STREAK_LOOKBACK_DAYS);
    }

    #[test]
    fn the_tray_goal_is_the_first_one_still_in_progress() {
        let r = rig();
        assert_eq!(r.service.tray_goal(UtcMs(D0)).unwrap(), None);
        let mut a = total_goal(Period::Daily, GoalKind::Minimum, HOUR);
        a.label = "A".into();
        let mut b = total_goal(Period::Daily, GoalKind::Minimum, 4 * HOUR);
        b.label = "B".into();
        r.service.save(a, UtcMs(D0)).unwrap();
        r.service.save(b, UtcMs(D0)).unwrap();
        spend(&r.store, "code", D0 + HOUR, D0 + 2 * HOUR + 30 * MIN);
        let top = r.service.tray_goal(UtcMs(D0 + 3 * HOUR)).unwrap().unwrap();
        assert_eq!(
            (top.label.as_str(), top.actual_ms, top.target_ms),
            ("B", 90 * MIN, 4 * HOUR)
        );
    }

    #[test]
    fn a_purge_warns_when_it_would_cut_an_active_streak() {
        let r = rig();
        r.service
            .save(
                total_goal(Period::Daily, GoalKind::Minimum, HOUR),
                UtcMs(70 * DAY),
            )
            .unwrap();
        // Days 80..=99 are all met: a 20 day streak starting at day 80.
        for day in 80..100 {
            spend(&r.store, "code", day * DAY + HOUR, day * DAY + 3 * HOUR);
        }
        let now = UtcMs(100 * DAY + 8 * HOUR);
        // Purging data older than 10 days (cutoff = day 90) cuts 10 days of the streak.
        let cutoff = UtcMs(90 * DAY + 8 * HOUR);
        assert_eq!(r.service.streak_days_cut(cutoff, now), Ok(Some(10)));
        // A cutoff before the streak starts touches nothing.
        assert_eq!(r.service.streak_days_cut(UtcMs(79 * DAY), now), Ok(None));
    }
    #[test]
    fn a_reviewed_week_lists_each_day_of_a_daily_goal_and_the_streak() {
        let r = rig();
        // Day 95 is a Monday (1970-01-01 was a Thursday).
        let monday = 95;
        let created = UtcMs((monday - 1) * DAY);
        let saved = r
            .service
            .save(total_goal(Period::Daily, GoalKind::Minimum, HOUR), created)
            .unwrap();
        spend(&r.store, "a", monday * DAY, monday * DAY + 90 * MIN);
        spend(
            &r.store,
            "a",
            (monday + 1) * DAY,
            (monday + 1) * DAY + 30 * MIN,
        );
        // Wednesday noon: Monday and Tuesday are closed, Wednesday is still open.
        let now = UtcMs((monday + 2) * DAY + 12 * HOUR);

        let weeks = r.service.week_outcomes(monday, now).unwrap();
        assert_eq!(weeks.len(), 1);
        let week = &weeks[0];
        assert_eq!(week.goal.id, saved.id);
        assert_eq!(week.periods.len(), 7);
        assert_eq!(week.periods[0].result, WeekResult::Met);
        assert_eq!(week.periods[0].actual_ms, 90 * MIN);
        assert_eq!(week.periods[1].result, WeekResult::Missed);
        assert_eq!(week.periods[2].result, WeekResult::InProgress);
        assert_eq!((week.met(), week.missed()), (1, 1));
        assert_eq!(week.best_streak, 1);
        assert_eq!(week.current_streak, 0, "Tuesday broke it");

        // A goal created after the week is not part of it.
        assert!(
            r.service
                .week_outcomes(monday - 14, now)
                .unwrap()
                .is_empty()
        );
    }
}
