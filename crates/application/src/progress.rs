//! Progress use cases: award strokes when blocks close and goals are met, settle the daily
//! limits once their days are over, update the seals, and read it all back for the UI.
//!
//! The rules live in `domain::progress`; the ledger is the [`ProgressRepository`], whose
//! `record` is idempotent per award key and applies the daily cap. So every award method can
//! run again over the same facts without granting twice.
//!
//! Progress is a side effect of focus and goals, never a reason for them to fail: the focus
//! and goal services reach it through [`ProgressSink`], whose methods cannot fail. Errors are
//! dropped there, the way the focus cycle blob is saved (best effort). A lost award is not
//! retried for blocks and reached goals; limits are re-settled over a lookback window, so a
//! failed settlement is caught up on the next run.
//!
//! The UI celebrates one [`Moment`] at a time: a new seal, a level-up or the full daily ensō.
//! Seals keep their `seen` flag in the ledger; what was acknowledged of the other two lives in
//! the [`ProgressMoments`] settings blob.

use std::collections::HashSet;
use std::sync::Arc;

use domain::progress::{block_awards, day_done, day_streak, earned_seals, level_for, longest_run};
use domain::{
    DayStreak, FocusEnd, FocusKind, Goal, GoalKind, LevelName, LevelProgress, Period, Seal,
    SealStats, StrokeAward, StrokeSource, UtcMs,
};

use crate::goals::{GoalService, WeekResult};
use crate::ports::{
    Calendar, PortError, PortResult, ProgressRepository, ReportRepository, SettingsRepository,
    StoredFocus, StrokeEntry,
};
use crate::settings_blobs::{KEY_PROGRESS_MOMENTS, ProgressMoments, read_blob, write_blob};

/// Closed days `settle_limits` looks back over: yesterday back to this many days ago.
pub const LIMIT_LOOKBACK_DAYS: i64 = 7;

/// Where focus and goals report what happened. Implementations never fail the caller.
pub trait ProgressSink: Send + Sync {
    /// A focus row was just closed (completed, cancelled or recovered).
    fn block_closed(&self, block: &StoredFocus, now: UtcMs);
    /// `goal` reached its target in the period that starts on local day `day`.
    fn goal_reached(&self, goal: &Goal, day: i64, now: UtcMs);
}

/// What the awards of a closed block depend on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClosedBlock {
    pub started: UtcMs,
    pub kind: FocusKind,
    pub end: FocusEnd,
    pub ended_at: UtcMs,
    /// Only computed for focus blocks with tracked time.
    pub percent_inside: Option<u32>,
}

impl ClosedBlock {
    /// `None` while the row is still running.
    pub fn of(stored: &StoredFocus) -> Option<Self> {
        Some(Self {
            started: stored.started_at,
            kind: stored.kind,
            end: stored.end_reason?,
            ended_at: stored.ended_at?,
            percent_inside: stored.summary.percent_inside(),
        })
    }
}

/// A seal as the UI shows it, earned or locked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SealView {
    pub seal: Seal,
    pub earned: bool,
    pub earned_at: Option<UtcMs>,
    /// The user acknowledged it; always `false` while locked.
    pub seen: bool,
    /// Progress toward `target`, capped at it ("12 of 30 days"); `target` once earned.
    pub current: u32,
    pub target: u32,
}

/// Everything the progress views read, in one call.
#[derive(Debug, Clone, PartialEq)]
pub struct ProgressSnapshot {
    /// Local day number the snapshot is about.
    pub today: i64,
    pub today_total: u32,
    /// The daily ensō is full.
    pub day_done: bool,
    /// Today's rows, oldest first.
    pub entries: Vec<StrokeEntry>,
    pub level: LevelProgress,
    pub streak: DayStreak,
    /// Whether each of the last seven local days holds strokes, oldest first, ending today.
    pub last7: [bool; 7],
    /// Every seal, in [`Seal::ALL`] order.
    pub seals: Vec<SealView>,
}

/// Something worth celebrating, shown until the user dismisses it. At most one at a time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Moment {
    /// A seal earned and not seen yet.
    Seal(Seal),
    /// A level reached and not acknowledged yet.
    Level { number: u8, name: LevelName },
    /// The daily ensō of local day `day` (today when reported) is full.
    DayDone { day: i64 },
}

pub struct ProgressService {
    progress: Arc<dyn ProgressRepository>,
    reports: Arc<dyn ReportRepository>,
    settings: Arc<dyn SettingsRepository>,
    calendar: Arc<dyn Calendar>,
}

impl ProgressService {
    pub fn new(
        progress: Arc<dyn ProgressRepository>,
        reports: Arc<dyn ReportRepository>,
        settings: Arc<dyn SettingsRepository>,
        calendar: Arc<dyn Calendar>,
    ) -> Self {
        Self {
            progress,
            reports,
            settings,
            calendar,
        }
    }

    /// Records what a closed block earns toward the local day it ended on, then updates the
    /// seals. Returns the seals earned by this call.
    pub fn on_block_closed(&self, block: &ClosedBlock, now: UtcMs) -> PortResult<Vec<Seal>> {
        let day = self.calendar.local_day(block.ended_at);
        for award in block_awards(block.started, block.kind, block.end, block.percent_inside) {
            self.progress.record(award, day, now)?;
        }
        self.update_seals(now)
    }

    /// A goal reached its target on `day`. Only daily minimum goals earn strokes for now;
    /// weekly and monthly ones earn nothing (limits are paid by [`Self::settle_limits`]).
    pub fn on_goal_reached(&self, goal: &Goal, day: i64, now: UtcMs) -> PortResult<Vec<Seal>> {
        if goal.period != Period::Daily || goal.kind != GoalKind::Minimum {
            return Ok(Vec::new());
        }
        self.progress
            .record(StrokeAward::GoalMet { goal: goal.id, day }, day, now)?;
        self.update_seals(now)
    }

    /// Pays every daily limit (maximum goal) respected on a closed day of the lookback
    /// window, yesterday back to [`LIMIT_LOOKBACK_DAYS`] days ago, toward that day.
    ///
    /// "Respected" is the goals' own closed-period outcome (`Met`), so rest days and days
    /// before the goal existed earn nothing. A day with no tracked time at all earns nothing
    /// either: a limit is trivially respected while the computer is off. Award keys make it
    /// safe to run as often as wanted.
    pub fn settle_limits(&self, goals: &GoalService, now: UtcMs) -> PortResult<Vec<Seal>> {
        let today = self.calendar.local_day(now);
        let first = today - LIMIT_LOOKBACK_DAYS;
        let weeks = goals
            .week_outcomes(first, now)
            .map_err(|e| PortError(e.to_string()))?;
        let limits: Vec<_> = weeks
            .iter()
            .filter(|w| w.goal.period == Period::Daily && w.goal.kind == GoalKind::Maximum)
            .collect();
        if limits.is_empty() {
            return Ok(Vec::new());
        }
        let tracked = self.tracked_days(first, today, now)?;
        for week in limits {
            for period in &week.periods {
                let day = period.start_day;
                // Closed days only: `Met` there is the goals' closed-period outcome.
                let respected = period.result == WeekResult::Met && day < today;
                if respected && tracked.contains(&day) {
                    let award = StrokeAward::LimitRespected {
                        goal: week.goal.id,
                        day,
                    };
                    self.progress.record(award, day, now)?;
                }
            }
        }
        self.update_seals(now)
    }

    /// The day, level, streak and seals as of `now`.
    pub fn snapshot(&self, now: UtcMs) -> PortResult<ProgressSnapshot> {
        let today = self.calendar.local_day(now);
        let today_total = self.progress.day_total(today)?;
        let stroke_days = self.progress.stroke_days()?;
        let streak = day_streak(&stroke_days, today);
        let stats = self.stats(streak)?;
        let earned = self.progress.seals()?;
        let seals = Seal::ALL
            .into_iter()
            .map(|seal| {
                let stored = earned.iter().find(|e| e.seal == seal);
                SealView {
                    seal,
                    earned: stored.is_some(),
                    earned_at: stored.map(|e| e.earned_at),
                    seen: stored.is_some_and(|e| e.seen),
                    current: if stored.is_some() {
                        seal.target()
                    } else {
                        seal.current(&stats)
                    },
                    target: seal.target(),
                }
            })
            .collect();
        Ok(ProgressSnapshot {
            today,
            today_total,
            day_done: day_done(today_total),
            entries: self.progress.day_entries(today)?,
            level: level_for(self.progress.total()?),
            streak,
            last7: std::array::from_fn(|i| stroke_days.contains(&(today - 6 + i as i64))),
            seals,
        })
    }

    /// The user acknowledged an earned seal.
    pub fn mark_seal_seen(&self, seal: Seal) -> PortResult<()> {
        self.progress.mark_seal_seen(seal)
    }

    /// The moment to celebrate as of `now`, if any.
    pub fn moment(&self, now: UtcMs) -> PortResult<Option<Moment>> {
        let snapshot = self.snapshot(now)?;
        self.moment_for(&snapshot)
    }

    /// The moment to celebrate given a fresh `snapshot`, by priority: the oldest unseen seal,
    /// then a level-up, then today's full ensō.
    ///
    /// The first look without any acknowledgement stored takes the current level as already
    /// seen (and stores it), so nobody gets a level-up card for a level reached before moments
    /// existed. A day not acknowledged yet is still celebrated.
    pub fn moment_for(&self, snapshot: &ProgressSnapshot) -> PortResult<Option<Moment>> {
        let mut acknowledged = self.acknowledged()?;
        let level = snapshot.level.level;
        let level_seen = match acknowledged.level_seen {
            Some(seen) => seen,
            None => {
                acknowledged.level_seen = Some(level.number);
                write_blob(self.settings.as_ref(), KEY_PROGRESS_MOMENTS, &acknowledged)?;
                level.number
            }
        };
        let unseen_seal = snapshot
            .seals
            .iter()
            .filter(|view| view.earned && !view.seen)
            .min_by_key(|view| view.earned_at)
            .map(|view| view.seal);
        if let Some(seal) = unseen_seal {
            return Ok(Some(Moment::Seal(seal)));
        }
        if level.number > level_seen {
            return Ok(Some(Moment::Level {
                number: level.number,
                name: level.name,
            }));
        }
        let day_done = snapshot.day_done && acknowledged.day_done_seen != Some(snapshot.today);
        Ok(day_done.then_some(Moment::DayDone {
            day: snapshot.today,
        }))
    }

    /// The user dismissed `moment`; it does not come back. A day-done moment is acknowledged
    /// for the day it was about, not the day of the dismissal: dismissing yesterday's card after
    /// midnight must leave today's own full ensō to celebrate.
    pub fn dismiss(&self, moment: Moment) -> PortResult<()> {
        match moment {
            Moment::Seal(seal) => self.mark_seal_seen(seal),
            Moment::Level { number, .. } => {
                let mut acknowledged = self.acknowledged()?;
                acknowledged.level_seen = Some(acknowledged.level_seen.unwrap_or(0).max(number));
                write_blob(self.settings.as_ref(), KEY_PROGRESS_MOMENTS, &acknowledged)
            }
            Moment::DayDone { day } => {
                let mut acknowledged = self.acknowledged()?;
                // Never back: a stale card dismissed late cannot revive a later day's.
                acknowledged.day_done_seen =
                    Some(acknowledged.day_done_seen.unwrap_or(day).max(day));
                write_blob(self.settings.as_ref(), KEY_PROGRESS_MOMENTS, &acknowledged)
            }
        }
    }

    fn acknowledged(&self) -> PortResult<ProgressMoments> {
        read_blob(self.settings.as_ref(), KEY_PROGRESS_MOMENTS)
    }

    /// Stores every seal the ledger now qualifies for; returns the new ones.
    fn update_seals(&self, now: UtcMs) -> PortResult<Vec<Seal>> {
        let today = self.calendar.local_day(now);
        let streak = day_streak(&self.progress.stroke_days()?, today);
        let stats = self.stats(streak)?;
        let mut new = Vec::new();
        for seal in earned_seals(&stats) {
            if self.progress.add_seal(seal, now)? {
                new.push(seal);
            }
        }
        Ok(new)
    }

    fn stats(&self, streak: DayStreak) -> PortResult<SealStats> {
        Ok(SealStats {
            focus_completed: self.progress.source_count(StrokeSource::FocusCompleted)?,
            breaks_taken: self.progress.source_count(StrokeSource::BreakTaken)?,
            best_streak: streak.best,
            best_full_run: longest_run(&self.progress.full_days()?),
        })
    }

    /// Local days in `[first, end)` holding any recorded time (tracked or assigned), from
    /// one load of the segments.
    fn tracked_days(&self, first: i64, end: i64, now: UtcMs) -> PortResult<HashSet<i64>> {
        let bounds: Vec<UtcMs> = (first..=end)
            .map(|day| self.calendar.start_of_day(day))
            .collect();
        let (from, to) = (bounds[0], bounds[bounds.len() - 1]);
        let mut days = HashSet::new();
        for segment in self.reports.segments_in_range(from, to)? {
            let (start, stop) = (segment.started_at, segment.ended_at.unwrap_or(now));
            for (day, window) in (first..).zip(bounds.windows(2)) {
                if start.max(window[0]) < stop.min(window[1]) {
                    days.insert(day);
                }
            }
        }
        Ok(days)
    }
}

/// Best effort: progress never breaks focus or goals, so failures are dropped here.
impl ProgressSink for ProgressService {
    fn block_closed(&self, block: &StoredFocus, now: UtcMs) {
        if let Some(block) = ClosedBlock::of(block) {
            let _ = self.on_block_closed(&block, now);
        }
    }

    fn goal_reached(&self, goal: &Goal, day: i64, now: UtcMs) {
        let _ = self.on_goal_reached(goal, day, now);
    }
}

#[cfg(test)]
mod tests {
    use domain::goals::GoalScope;
    use domain::{
        EndReason, FocusAllowed, FocusSummary, LevelName, Productivity, Segment, SegmentId,
        SegmentSource,
    };

    use super::*;
    use crate::fakes::{
        FakeActivities, FakeFocus, FakeGoals, FakeProgress, FakeSettings, FakeStore, FixedCalendar,
    };
    use crate::focus::{FocusService, StartRequest};
    use crate::ports::{ActivityRepository, EarnedSeal, FocusRepository};

    const MIN: i64 = 60_000;
    const HOUR: i64 = 60 * MIN;
    const DAY: i64 = 24 * HOUR;

    struct Rig {
        service: Arc<ProgressService>,
        progress: FakeProgress,
        store: FakeStore,
        settings: FakeSettings,
    }

    fn rig() -> Rig {
        let progress = FakeProgress::default();
        let store = FakeStore::default();
        let settings = FakeSettings::default();
        let service = Arc::new(ProgressService::new(
            Arc::new(progress.clone()),
            Arc::new(store.clone()),
            Arc::new(settings.clone()),
            Arc::new(FixedCalendar::fixed(0)),
        ));
        Rig {
            service,
            progress,
            store,
            settings,
        }
    }

    fn at(day: i64, ms: i64) -> UtcMs {
        UtcMs(day * DAY + ms)
    }

    fn block(kind: FocusKind, end: FocusEnd, started: UtcMs, ended: UtcMs) -> ClosedBlock {
        ClosedBlock {
            started,
            kind,
            end,
            ended_at: ended,
            percent_inside: Some(85),
        }
    }

    fn focus_on(day: i64) -> ClosedBlock {
        block(
            FocusKind::Focus,
            FocusEnd::Completed,
            at(day, 9 * HOUR),
            at(day, 10 * HOUR),
        )
    }

    fn spend(store: &FakeStore, app: &str, from: UtcMs, to: UtcMs) {
        store.seed_segment(Segment {
            id: SegmentId(0),
            started_at: from,
            ended_at: Some(to),
            heartbeat_at: to,
            app_id: Some(app.into()),
            app_name: Some(app.into()),
            window_title: None,
            end_reason: Some(EndReason::FocusChange),
            source: SegmentSource::Tracked,
            activity_id: None,
        });
    }

    fn daily(kind: GoalKind, period: Period, scope: GoalScope, target_ms: i64) -> Goal {
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

    fn goals_over(store: &FakeStore, progress: Option<Arc<ProgressService>>) -> GoalService {
        let service = GoalService::new(
            Arc::new(FakeGoals::default()),
            Arc::new(store.clone()),
            Arc::new(FakeActivities::default()),
            Arc::new(FakeSettings::default()),
            Arc::new(FixedCalendar::fixed(0)),
        );
        match progress {
            Some(sink) => service.with_progress(sink),
            None => service,
        }
    }

    fn total(progress: &FakeProgress) -> u64 {
        progress.total().unwrap()
    }

    #[test]
    fn a_completed_focus_block_on_target_earns_fifteen_on_the_day_it_ends() {
        let r = rig();
        // 23:30 on day 100 to 00:20 on day 101: the strokes belong to day 101.
        let b = block(
            FocusKind::Focus,
            FocusEnd::Completed,
            at(100, 23 * HOUR + 30 * MIN),
            at(101, 20 * MIN),
        );
        r.service.on_block_closed(&b, at(101, HOUR)).unwrap();
        assert_eq!(r.progress.day_total(101), Ok(15));
        assert_eq!(r.progress.day_total(100), Ok(0));
    }

    #[test]
    fn a_cancelled_block_earns_nothing() {
        let r = rig();
        let mut b = focus_on(100);
        b.end = FocusEnd::Cancelled;
        r.service.on_block_closed(&b, at(100, 11 * HOUR)).unwrap();
        assert!(r.progress.entries().is_empty());
    }

    #[test]
    fn closing_the_same_block_twice_counts_once() {
        let r = rig();
        let b = focus_on(100);
        r.service.on_block_closed(&b, at(100, 11 * HOUR)).unwrap();
        r.service.on_block_closed(&b, at(100, 12 * HOUR)).unwrap();
        assert_eq!(total(&r.progress), 15);
        assert_eq!(r.progress.entries().len(), 2);
    }

    #[test]
    fn a_break_earns_three() {
        let r = rig();
        let b = block(
            FocusKind::Break,
            FocusEnd::Recovered,
            at(100, HOUR),
            at(100, HOUR + 5 * MIN),
        );
        r.service.on_block_closed(&b, at(100, 2 * HOUR)).unwrap();
        assert_eq!(r.progress.day_total(100), Ok(3));
    }

    #[test]
    fn a_daily_goal_reached_earns_fifteen_and_a_weekly_one_nothing() {
        let r = rig();
        let mut goal = daily(GoalKind::Minimum, Period::Daily, GoalScope::Total, HOUR);
        goal.id = 4;
        r.service
            .on_goal_reached(&goal, 100, at(100, HOUR))
            .unwrap();
        r.service
            .on_goal_reached(&goal, 100, at(100, HOUR))
            .unwrap();
        assert_eq!(r.progress.day_total(100), Ok(15));
        let weekly = Goal {
            id: 5,
            period: Period::Weekly,
            ..goal
        };
        r.service
            .on_goal_reached(&weekly, 100, at(100, HOUR))
            .unwrap();
        assert_eq!(r.progress.day_total(100), Ok(15));
    }

    #[test]
    fn evaluating_goals_pays_a_reached_daily_minimum_through_the_hook() {
        let r = rig();
        let goals = goals_over(&r.store, Some(r.service.clone()));
        goals
            .save(
                daily(GoalKind::Minimum, Period::Daily, GoalScope::Total, HOUR),
                at(100, 0),
            )
            .unwrap();
        spend(&r.store, "code", at(100, HOUR), at(100, 3 * HOUR));
        goals.evaluate(at(100, 4 * HOUR)).unwrap();
        goals.evaluate(at(100, 5 * HOUR)).unwrap();
        assert_eq!(r.progress.day_total(100), Ok(15));
    }

    /// A daily limit on mail created on day 90; today is day 100, so days 93..=99 settle.
    fn limit_rig() -> (Rig, GoalService) {
        let r = rig();
        let goals = goals_over(&r.store, None);
        goals
            .save(
                daily(
                    GoalKind::Maximum,
                    Period::Daily,
                    GoalScope::App("mail".into()),
                    HOUR,
                ),
                at(90, 0),
            )
            .unwrap();
        (r, goals)
    }

    #[test]
    fn a_respected_limit_pays_only_on_days_with_tracked_time() {
        let (r, goals) = limit_rig();
        // Day 96: no mail but other work, respected with time tracked.
        spend(&r.store, "code", at(96, HOUR), at(96, 2 * HOUR));
        // Day 98: 30 minutes of mail, under the limit.
        spend(&r.store, "mail", at(98, HOUR), at(98, HOUR + 30 * MIN));
        // Day 99: two hours of mail, over it.
        spend(&r.store, "mail", at(99, HOUR), at(99, 3 * HOUR));
        // Today is still open: nothing is settled for it.
        spend(&r.store, "code", at(100, HOUR), at(100, 2 * HOUR));
        r.service.settle_limits(&goals, at(100, 8 * HOUR)).unwrap();

        let mut days: Vec<(i64, u32)> = r
            .progress
            .entries()
            .iter()
            .map(|e| (e.day, e.strokes))
            .collect();
        days.sort_unstable();
        // Days 93, 94, 95 and 97 were empty: respected, but the computer was off.
        assert_eq!(days, vec![(96, 10), (98, 10)]);
        assert!(
            r.progress
                .entries()
                .iter()
                .all(|e| e.source == StrokeSource::LimitRespected)
        );
    }

    #[test]
    fn settling_twice_grants_once() {
        let (r, goals) = limit_rig();
        spend(&r.store, "code", at(98, HOUR), at(98, 2 * HOUR));
        r.service.settle_limits(&goals, at(100, HOUR)).unwrap();
        r.service.settle_limits(&goals, at(100, 2 * HOUR)).unwrap();
        // The next day still sees day 98 in its window.
        r.service.settle_limits(&goals, at(101, HOUR)).unwrap();
        assert_eq!(total(&r.progress), 10);
    }

    #[test]
    fn minimum_goals_are_not_settled_as_limits() {
        let r = rig();
        let goals = goals_over(&r.store, None);
        goals
            .save(
                daily(GoalKind::Minimum, Period::Daily, GoalScope::Total, HOUR),
                at(90, 0),
            )
            .unwrap();
        spend(&r.store, "code", at(98, HOUR), at(98, 3 * HOUR));
        r.service.settle_limits(&goals, at(100, HOUR)).unwrap();
        assert!(r.progress.entries().is_empty());
    }

    #[test]
    fn the_daily_cap_holds_across_sources() {
        let r = rig();
        for id in 1..=6 {
            let mut goal = daily(GoalKind::Minimum, Period::Daily, GoalScope::Total, HOUR);
            goal.id = id;
            r.service
                .on_goal_reached(&goal, 100, at(100, HOUR))
                .unwrap();
        }
        // 90 so far: the block's 15 only fits 10, the break gets nothing.
        r.service
            .on_block_closed(&focus_on(100), at(100, 11 * HOUR))
            .unwrap();
        let brk = block(
            FocusKind::Break,
            FocusEnd::Completed,
            at(100, 10 * HOUR),
            at(100, 10 * HOUR + 5 * MIN),
        );
        r.service.on_block_closed(&brk, at(100, 11 * HOUR)).unwrap();
        assert_eq!(r.progress.day_total(100), Ok(domain::DAILY_CAP));
        let snapshot = r.service.snapshot(at(100, 12 * HOUR)).unwrap();
        assert!(snapshot.day_done);
        assert_eq!(snapshot.entries.len(), 9);
    }

    #[test]
    fn first_focus_is_earned_after_the_first_block_and_only_once() {
        let r = rig();
        let first = r
            .service
            .on_block_closed(&focus_on(100), at(100, 11 * HOUR))
            .unwrap();
        assert_eq!(first, vec![Seal::FirstFocus]);
        let second = r
            .service
            .on_block_closed(&focus_on(101), at(101, 11 * HOUR))
            .unwrap();
        assert!(second.is_empty());
        let seals = r.progress.seals().unwrap();
        assert_eq!(seals.len(), 1);
        assert_eq!(seals[0].earned_at, at(100, 11 * HOUR));
    }

    #[test]
    fn the_snapshot_reports_level_streak_and_seal_progress() {
        let r = rig();
        for day in [98, 99, 100] {
            r.service
                .on_block_closed(&focus_on(day), at(day, 11 * HOUR))
                .unwrap();
        }
        let s = r.service.snapshot(at(100, 12 * HOUR)).unwrap();
        assert_eq!((s.today, s.today_total, s.day_done), (100, 15, false));
        assert_eq!(s.entries.len(), 2);
        assert_eq!(s.level.total, 45);
        assert_eq!(s.level.level.name, LevelName::Start);
        assert_eq!(s.level.next.map(|l| l.name), Some(LevelName::Steady));
        assert_eq!((s.streak.current, s.streak.best), (3, 3));
        assert_eq!(s.last7, [false, false, false, false, true, true, true]);

        let view = |seal: Seal| *s.seals.iter().find(|v| v.seal == seal).unwrap();
        assert_eq!(s.seals.len(), Seal::ALL.len());
        let first = view(Seal::FirstFocus);
        assert!(first.earned && !first.seen);
        assert_eq!(first.earned_at, Some(at(98, 11 * HOUR)));
        assert_eq!((first.current, first.target), (1, 1));
        let ten = view(Seal::TenSessions);
        assert!(!ten.earned && ten.earned_at.is_none());
        assert_eq!((ten.current, ten.target), (3, 10));
        assert_eq!(
            (view(Seal::SevenDays).current, view(Seal::SevenDays).target),
            (3, 7)
        );
        assert_eq!(view(Seal::TookTheBreak).current, 0);

        r.service.mark_seal_seen(Seal::FirstFocus).unwrap();
        let s = r.service.snapshot(at(100, 12 * HOUR)).unwrap();
        assert!(
            s.seals
                .iter()
                .find(|v| v.seal == Seal::FirstFocus)
                .unwrap()
                .seen
        );
        // Tomorrow, before any stroke, the streak still stands.
        let s = r.service.snapshot(at(101, HOUR)).unwrap();
        assert_eq!((s.today_total, s.streak.current), (0, 3));
        assert_eq!(s.last7, [false, false, false, true, true, true, false]);
    }

    // ---- moments ----

    /// Fills local day `day` to the cap (seven daily goals of 15, the last one capped).
    fn fill_day(r: &Rig, day: i64) {
        for goal in 1..=7 {
            r.progress
                .record(StrokeAward::GoalMet { goal, day }, day, at(day, HOUR))
                .unwrap();
        }
    }

    fn acknowledged(r: &Rig) -> ProgressMoments {
        read_blob(&r.settings, KEY_PROGRESS_MOMENTS).unwrap()
    }

    #[test]
    fn a_fresh_ledger_has_no_moment_and_the_first_look_stores_the_level_baseline() {
        let r = rig();
        assert_eq!(acknowledged(&r), ProgressMoments::default());
        assert_eq!(r.service.moment(at(100, HOUR)), Ok(None));
        assert_eq!(acknowledged(&r).level_seen, Some(1));
        assert_eq!(acknowledged(&r).day_done_seen, None);
    }

    #[test]
    fn a_level_reached_before_the_first_look_is_not_celebrated() {
        let r = rig();
        for day in 97..=99 {
            fill_day(&r, day);
        }
        // 300 strokes: level 2, reached before moments were ever looked at.
        assert_eq!(r.service.moment(at(100, HOUR)), Ok(None));
        assert_eq!(acknowledged(&r).level_seen, Some(2));
        assert_eq!(r.service.moment(at(100, 2 * HOUR)), Ok(None));
    }

    #[test]
    fn without_acknowledgements_a_full_day_is_still_celebrated_but_only_on_that_day() {
        let r = rig();
        fill_day(&r, 100);
        assert_eq!(
            r.service.moment(at(100, 2 * HOUR)),
            Ok(Some(Moment::DayDone { day: 100 }))
        );
        // Never dismissed: the next day does not bring it back.
        assert_eq!(r.service.moment(at(101, HOUR)), Ok(None));
    }

    #[test]
    fn moments_come_one_at_a_time_seals_oldest_first_then_level_then_the_day() {
        let r = rig();
        assert_eq!(r.service.moment(at(97, 0)), Ok(None));
        let brk = block(
            FocusKind::Break,
            FocusEnd::Completed,
            at(97, 9 * HOUR),
            at(97, 9 * HOUR + 5 * MIN),
        );
        r.service.on_block_closed(&brk, at(97, 10 * HOUR)).unwrap();
        r.service
            .on_block_closed(&focus_on(98), at(98, 11 * HOUR))
            .unwrap();
        for day in 97..=99 {
            fill_day(&r, day);
        }
        let now = at(99, 20 * HOUR);
        let expected = [
            // Earned on day 97, before First focus although it comes later in `Seal::ALL`.
            Moment::Seal(Seal::TookTheBreak),
            Moment::Seal(Seal::FirstFocus),
            Moment::Level {
                number: 2,
                name: LevelName::Steady,
            },
            Moment::DayDone { day: 99 },
        ];
        for moment in expected {
            assert_eq!(r.service.moment(now), Ok(Some(moment)));
            r.service.dismiss(moment).unwrap();
        }
        assert_eq!(r.service.moment(now), Ok(None));

        let s = r.service.snapshot(now).unwrap();
        assert!(s.seals.iter().filter(|v| v.earned).all(|v| v.seen));
        assert_eq!(
            acknowledged(&r),
            ProgressMoments {
                level_seen: Some(2),
                day_done_seen: Some(99),
            }
        );
        // A new full day is celebrated again.
        fill_day(&r, 100);
        assert_eq!(
            r.service.moment(at(100, 20 * HOUR)),
            Ok(Some(Moment::DayDone { day: 100 }))
        );
    }

    #[test]
    fn a_full_day_dismissed_after_midnight_leaves_the_new_day_to_celebrate() {
        let r = rig();
        fill_day(&r, 100);
        let card = r.service.moment(at(100, 23 * HOUR)).unwrap().unwrap();
        assert_eq!(card, Moment::DayDone { day: 100 });
        // The card stayed up past midnight and is dismissed on day 101.
        r.service.dismiss(card).unwrap();
        assert_eq!(acknowledged(&r).day_done_seen, Some(100));
        fill_day(&r, 101);
        assert_eq!(
            r.service.moment(at(101, 20 * HOUR)),
            Ok(Some(Moment::DayDone { day: 101 }))
        );
        // A stale card for day 100 dismissed after day 101's never lowers it.
        r.service.dismiss(Moment::DayDone { day: 101 }).unwrap();
        r.service.dismiss(card).unwrap();
        assert_eq!(acknowledged(&r).day_done_seen, Some(101));
        assert_eq!(r.service.moment(at(101, 21 * HOUR)), Ok(None));
    }

    #[test]
    fn dismissing_a_level_never_lowers_the_one_acknowledged() {
        let r = rig();
        r.service
            .dismiss(Moment::Level {
                number: 3,
                name: LevelName::Rhythm,
            })
            .unwrap();
        r.service
            .dismiss(Moment::Level {
                number: 2,
                name: LevelName::Steady,
            })
            .unwrap();
        assert_eq!(acknowledged(&r).level_seen, Some(3));
    }

    // ---- hooks in the focus service ----

    fn focus_service(
        store: &FakeStore,
        focus: &FakeFocus,
        sink: Arc<dyn ProgressSink>,
    ) -> FocusService {
        let activities = FakeActivities::default();
        activities
            .create("Unassigned", "#999", Productivity::Neutral)
            .unwrap();
        FocusService::new(
            Arc::new(focus.clone()),
            Arc::new(store.clone()),
            Arc::new(activities),
            Arc::new(FakeSettings::default()),
        )
        .with_progress(sink)
    }

    fn request(kind: FocusKind) -> StartRequest {
        StartRequest {
            kind,
            intent: if kind == FocusKind::Focus {
                "Write".into()
            } else {
                String::new()
            },
            planned_ms: 25 * MIN,
            allowed: if kind == FocusKind::Focus {
                FocusAllowed {
                    activities: Vec::new(),
                    apps: vec!["excel".into()],
                }
            } else {
                FocusAllowed::default()
            },
        }
    }

    #[test]
    fn a_focus_block_that_runs_its_course_is_paid_through_the_hook() {
        let r = rig();
        let focus = FakeFocus::default();
        let service = focus_service(&r.store, &focus, r.service.clone());
        let t0 = at(100, 9 * HOUR);
        service
            .start(request(FocusKind::Focus), None, None, t0)
            .unwrap();
        // 85% inside: 21m15s in excel, 3m45s in slack.
        let split = t0.plus_ms(21 * MIN + 15_000);
        spend(&r.store, "excel", t0, split);
        spend(&r.store, "slack", split, t0.plus_ms(25 * MIN));
        let done = service
            .tick(t0.plus_ms(25 * MIN))
            .unwrap()
            .finished
            .unwrap();
        assert_eq!(done.summary.percent_inside(), Some(85));
        assert_eq!(r.progress.day_total(100), Ok(15));
        assert_eq!(r.progress.seals().unwrap()[0].seal, Seal::FirstFocus);
    }

    #[test]
    fn a_stopped_block_earns_nothing_and_a_recovered_break_earns_three() {
        let r = rig();
        let focus = FakeFocus::default();
        let service = focus_service(&r.store, &focus, r.service.clone());
        let t0 = at(100, 9 * HOUR);
        service
            .start(request(FocusKind::Focus), None, None, t0)
            .unwrap();
        service.stop(t0.plus_ms(5 * MIN)).unwrap();
        assert!(r.progress.entries().is_empty());

        // A break left running when the app quit closes as recovered at the next start.
        service
            .start(request(FocusKind::Break), None, None, t0.plus_ms(10 * MIN))
            .unwrap();
        let again = focus_service(&r.store, &focus, r.service.clone());
        let out = again.recover(None, at(100, 12 * HOUR)).unwrap();
        assert_eq!(out.finished.unwrap().end_reason, Some(FocusEnd::Recovered));
        assert_eq!(r.progress.day_total(100), Ok(3));
    }

    /// A ledger whose every call fails.
    struct BrokenProgress;

    fn broken<T>() -> PortResult<T> {
        Err(PortError("disk full".into()))
    }

    impl ProgressRepository for BrokenProgress {
        fn record(&self, _: StrokeAward, _: i64, _: UtcMs) -> PortResult<Option<u32>> {
            broken()
        }
        fn day_total(&self, _: i64) -> PortResult<u32> {
            broken()
        }
        fn day_entries(&self, _: i64) -> PortResult<Vec<StrokeEntry>> {
            broken()
        }
        fn total(&self) -> PortResult<u64> {
            broken()
        }
        fn stroke_days(&self) -> PortResult<Vec<i64>> {
            broken()
        }
        fn full_days(&self) -> PortResult<Vec<i64>> {
            broken()
        }
        fn source_count(&self, _: StrokeSource) -> PortResult<u32> {
            broken()
        }
        fn seals(&self) -> PortResult<Vec<EarnedSeal>> {
            broken()
        }
        fn add_seal(&self, _: Seal, _: UtcMs) -> PortResult<bool> {
            broken()
        }
        fn mark_seal_seen(&self, _: Seal) -> PortResult<()> {
            broken()
        }
    }

    #[test]
    fn a_failing_ledger_never_breaks_closing_a_focus_session_or_evaluating_goals() {
        let store = FakeStore::default();
        let sink = Arc::new(ProgressService::new(
            Arc::new(BrokenProgress),
            Arc::new(store.clone()),
            Arc::new(FakeSettings::default()),
            Arc::new(FixedCalendar::fixed(0)),
        ));
        let focus = FakeFocus::default();
        let service = focus_service(&store, &focus, sink.clone());
        let t0 = at(100, 9 * HOUR);
        service
            .start(request(FocusKind::Focus), None, None, t0)
            .unwrap();
        let done = service
            .tick(t0.plus_ms(25 * MIN))
            .unwrap()
            .finished
            .unwrap();
        assert_eq!(done.end_reason, Some(FocusEnd::Completed));
        assert!(focus.running().unwrap().is_none());
        assert_eq!(done.summary, FocusSummary::default());

        let goals = goals_over(&store, Some(sink.clone()));
        goals
            .save(
                daily(GoalKind::Minimum, Period::Daily, GoalScope::Total, HOUR),
                at(100, 0),
            )
            .unwrap();
        spend(&store, "code", at(100, HOUR), at(100, 3 * HOUR));
        assert_eq!(
            goals.evaluate(at(100, 4 * HOUR)).unwrap().crossings.len(),
            1
        );
        // The direct calls do report the failure.
        assert!(sink.snapshot(at(100, 5 * HOUR)).is_err());
    }
}
