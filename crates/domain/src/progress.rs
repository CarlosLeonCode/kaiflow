//! Progress (gamification): strokes earned for intention and consistency, never for more hours.
//!
//! Every award has a stable key so it is granted once, the day holds at most [`DAILY_CAP`]
//! strokes, levels come from all strokes ever earned, and seals are one-time achievements.
//! Days are local day numbers, as in [`crate::calendar`].

use crate::focus_session::{FocusEnd, FocusKind};
use crate::time::UtcMs;

/// Strokes one day can hold: the daily ensō. Staying late earns nothing past it.
pub const DAILY_CAP: u32 = 100;

/// Share of a focus block spent inside its allowed set that earns the on-target bonus.
pub const ON_TARGET_PERCENT: u32 = 80;

/// Why strokes were earned. Stored by name in the strokes ledger.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Source {
    FocusCompleted,
    FocusOnTarget,
    BreakTaken,
    GoalMet,
    LimitRespected,
}

impl Source {
    pub const ALL: [Self; 5] = [
        Self::FocusCompleted,
        Self::FocusOnTarget,
        Self::BreakTaken,
        Self::GoalMet,
        Self::LimitRespected,
    ];

    /// Strokes this source is worth before the daily cap.
    pub fn strokes(self) -> u32 {
        match self {
            Self::FocusCompleted => 10,
            Self::FocusOnTarget => 5,
            Self::BreakTaken => 3,
            Self::GoalMet => 15,
            Self::LimitRespected => 10,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::FocusCompleted => "focus_completed",
            Self::FocusOnTarget => "focus_on_target",
            Self::BreakTaken => "break_taken",
            Self::GoalMet => "goal_met",
            Self::LimitRespected => "limit_respected",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|source| source.as_str() == name)
    }
}

/// One thing that earns strokes, tied to the record it came from: a block by its start time,
/// a goal by its id and day.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Award {
    FocusCompleted { started: UtcMs },
    FocusOnTarget { started: UtcMs },
    BreakTaken { started: UtcMs },
    GoalMet { goal: i64, day: i64 },
    LimitRespected { goal: i64, day: i64 },
}

impl Award {
    pub fn source(self) -> Source {
        match self {
            Self::FocusCompleted { .. } => Source::FocusCompleted,
            Self::FocusOnTarget { .. } => Source::FocusOnTarget,
            Self::BreakTaken { .. } => Source::BreakTaken,
            Self::GoalMet { .. } => Source::GoalMet,
            Self::LimitRespected { .. } => Source::LimitRespected,
        }
    }

    pub fn strokes(self) -> u32 {
        self.source().strokes()
    }

    /// Unique key of this award: recording the same award twice must grant nothing.
    pub fn key(self) -> String {
        let source = self.source().as_str();
        match self {
            Self::FocusCompleted { started }
            | Self::FocusOnTarget { started }
            | Self::BreakTaken { started } => format!("{source}:{}", started.0),
            Self::GoalMet { goal, day } | Self::LimitRespected { goal, day } => {
                format!("{source}:{goal}:{day}")
            }
        }
    }
}

/// Awards for a block that just ended.
///
/// A focus block that ran its course earns [`Source::FocusCompleted`], plus
/// [`Source::FocusOnTarget`] when [`ON_TARGET_PERCENT`] or more of it was inside. A break that
/// ran its course earns [`Source::BreakTaken`]. Cancelled blocks and plain timers earn nothing.
/// `Recovered` counts as run: the time passed while the app was closed.
///
/// Blocks are identified by `started`, not by their row id: ids can be reused after the newest
/// sessions are deleted, and a reused id would make a new block look already rewarded.
pub fn block_awards(
    started: UtcMs,
    kind: FocusKind,
    end: FocusEnd,
    percent_inside: Option<u32>,
) -> Vec<Award> {
    if end == FocusEnd::Cancelled {
        return Vec::new();
    }
    match kind {
        FocusKind::Focus => {
            let mut awards = vec![Award::FocusCompleted { started }];
            if percent_inside.is_some_and(|pct| pct >= ON_TARGET_PERCENT) {
                awards.push(Award::FocusOnTarget { started });
            }
            awards
        }
        FocusKind::Break => vec![Award::BreakTaken { started }],
        FocusKind::Timer => Vec::new(),
    }
}

/// Strokes actually granted for an award worth `strokes` on a day that already holds
/// `day_total`: whatever still fits under [`DAILY_CAP`].
pub fn grant(day_total: u32, strokes: u32) -> u32 {
    strokes.min(DAILY_CAP.saturating_sub(day_total))
}

/// The daily ensō is full.
pub fn day_done(day_total: u32) -> bool {
    day_total >= DAILY_CAP
}

/// Names go from a start to kaizen, the idea behind Kaiflow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LevelName {
    Start,
    Steady,
    Rhythm,
    Flow,
    Craft,
    Mastery,
    Kaizen,
}

impl LevelName {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Steady => "steady",
            Self::Rhythm => "rhythm",
            Self::Flow => "flow",
            Self::Craft => "craft",
            Self::Mastery => "mastery",
            Self::Kaizen => "kaizen",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Level {
    /// 1-based.
    pub number: u8,
    pub name: LevelName,
    /// All-time strokes needed to reach it.
    pub min_strokes: u64,
}

pub const LEVELS: [Level; 7] = [
    Level {
        number: 1,
        name: LevelName::Start,
        min_strokes: 0,
    },
    Level {
        number: 2,
        name: LevelName::Steady,
        min_strokes: 300,
    },
    Level {
        number: 3,
        name: LevelName::Rhythm,
        min_strokes: 900,
    },
    Level {
        number: 4,
        name: LevelName::Flow,
        min_strokes: 2_000,
    },
    Level {
        number: 5,
        name: LevelName::Craft,
        min_strokes: 4_000,
    },
    Level {
        number: 6,
        name: LevelName::Mastery,
        min_strokes: 7_000,
    },
    Level {
        number: 7,
        name: LevelName::Kaizen,
        min_strokes: 12_000,
    },
];

/// Where all-time strokes put you on the path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LevelProgress {
    pub total: u64,
    pub level: Level,
    /// `None` at the last level.
    pub next: Option<Level>,
}

impl LevelProgress {
    /// Strokes earned since reaching the current level ("410" in "410 of 600 to Craft").
    pub fn into_level(&self) -> u64 {
        self.total - self.level.min_strokes
    }

    /// Strokes between the current level and the next ("600"); `None` at the last level.
    pub fn span(&self) -> Option<u64> {
        self.next
            .map(|next| next.min_strokes - self.level.min_strokes)
    }

    /// Share of the way to the next level, 0..=1; 1 at the last level.
    pub fn fraction(&self) -> f64 {
        match self.span() {
            Some(span) => self.into_level() as f64 / span as f64,
            None => 1.0,
        }
    }
}

pub fn level_for(total: u64) -> LevelProgress {
    let index = LEVELS
        .iter()
        .rposition(|level| total >= level.min_strokes)
        .unwrap_or(0);
    LevelProgress {
        total,
        level: LEVELS[index],
        next: LEVELS.get(index + 1).copied(),
    }
}

/// Consecutive days with strokes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DayStreak {
    /// The run ending today, or yesterday while today has no strokes yet: a day that is not
    /// over never breaks the streak.
    pub current: u32,
    /// Longest run in the days given.
    pub best: u32,
}

/// Streak over `days` (in any order, duplicates allowed); days after `today` are ignored.
pub fn day_streak(days: &[i64], today: i64) -> DayStreak {
    let days = sorted_until(days, today);
    let best = longest_run_sorted(&days);
    let end = match days.last() {
        Some(&last) if last == today || last == today - 1 => last,
        _ => return DayStreak { current: 0, best },
    };
    let mut current = 0u32;
    for (i, &day) in days.iter().rev().enumerate() {
        if day != end - i as i64 {
            break;
        }
        current += 1;
    }
    DayStreak { current, best }
}

/// Longest run of consecutive days in `days` (in any order, duplicates allowed).
pub fn longest_run(days: &[i64]) -> u32 {
    longest_run_sorted(&sorted_until(days, i64::MAX))
}

fn sorted_until(days: &[i64], last: i64) -> Vec<i64> {
    let mut days: Vec<i64> = days.iter().copied().filter(|&day| day <= last).collect();
    days.sort_unstable();
    days.dedup();
    days
}

fn longest_run_sorted(days: &[i64]) -> u32 {
    let (mut run, mut best) = (0u32, 0u32);
    for (i, &day) in days.iter().enumerate() {
        run = if i > 0 && day == days[i - 1] + 1 {
            run + 1
        } else {
            1
        };
        best = best.max(run);
    }
    best
}

/// The pop color family a seal is drawn in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SealFamily {
    Focus,
    Streaks,
    Breaks,
    Goals,
}

impl SealFamily {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Focus => "focus",
            Self::Streaks => "streaks",
            Self::Breaks => "breaks",
            Self::Goals => "goals",
        }
    }
}

/// One-time achievements. Stored by name once earned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Seal {
    FirstFocus,
    TenSessions,
    TookTheBreak,
    SevenDays,
    ThirtyDays,
    /// Seven days in a row with a full daily ensō: the only closed circle in Kaiflow.
    PerfectWeek,
}

/// What seals are judged on, gathered from the strokes ledger.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SealStats {
    pub focus_completed: u32,
    pub breaks_taken: u32,
    /// Longest run of days with strokes.
    pub best_streak: u32,
    /// Longest run of days with a full daily ensō.
    pub best_full_run: u32,
}

impl Seal {
    pub const ALL: [Self; 6] = [
        Self::FirstFocus,
        Self::SevenDays,
        Self::TenSessions,
        Self::TookTheBreak,
        Self::PerfectWeek,
        Self::ThirtyDays,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::FirstFocus => "first_focus",
            Self::TenSessions => "ten_sessions",
            Self::TookTheBreak => "took_the_break",
            Self::SevenDays => "seven_days",
            Self::ThirtyDays => "thirty_days",
            Self::PerfectWeek => "perfect_week",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|seal| seal.as_str() == name)
    }

    pub fn family(self) -> SealFamily {
        match self {
            Self::FirstFocus | Self::TenSessions => SealFamily::Focus,
            Self::SevenDays | Self::ThirtyDays => SealFamily::Streaks,
            Self::TookTheBreak => SealFamily::Breaks,
            Self::PerfectWeek => SealFamily::Goals,
        }
    }

    /// How much of [`Self::target`] it takes.
    pub fn target(self) -> u32 {
        match self {
            Self::FirstFocus | Self::TookTheBreak => 1,
            Self::SevenDays | Self::PerfectWeek => 7,
            Self::TenSessions => 10,
            Self::ThirtyDays => 30,
        }
    }

    /// Progress toward the target, capped at it ("12 of 30 days").
    pub fn current(self, stats: &SealStats) -> u32 {
        let value = match self {
            Self::FirstFocus | Self::TenSessions => stats.focus_completed,
            Self::TookTheBreak => stats.breaks_taken,
            Self::SevenDays | Self::ThirtyDays => stats.best_streak,
            Self::PerfectWeek => stats.best_full_run,
        };
        value.min(self.target())
    }

    pub fn is_earned(self, stats: &SealStats) -> bool {
        self.current(stats) >= self.target()
    }
}

/// Seals `stats` qualify for, in [`Seal::ALL`] order.
pub fn earned_seals(stats: &SealStats) -> Vec<Seal> {
    Seal::ALL
        .into_iter()
        .filter(|seal| seal.is_earned(stats))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn focus_block_that_ran_earns_ten_and_the_bonus_on_target() {
        let awards = block_awards(UtcMs(7), FocusKind::Focus, FocusEnd::Completed, Some(80));
        assert_eq!(
            awards,
            vec![
                Award::FocusCompleted { started: UtcMs(7) },
                Award::FocusOnTarget { started: UtcMs(7) }
            ]
        );
        assert_eq!(awards.iter().map(|a| a.strokes()).sum::<u32>(), 15);
    }

    #[test]
    fn focus_block_under_target_or_without_data_earns_no_bonus() {
        for pct in [Some(79), None] {
            assert_eq!(
                block_awards(UtcMs(1), FocusKind::Focus, FocusEnd::Completed, pct),
                vec![Award::FocusCompleted { started: UtcMs(1) }]
            );
        }
    }

    #[test]
    fn recovered_blocks_count_and_cancelled_ones_do_not() {
        assert_eq!(
            block_awards(UtcMs(2), FocusKind::Break, FocusEnd::Recovered, None),
            vec![Award::BreakTaken { started: UtcMs(2) }]
        );
        for kind in [FocusKind::Focus, FocusKind::Break, FocusKind::Timer] {
            assert!(block_awards(UtcMs(3), kind, FocusEnd::Cancelled, Some(100)).is_empty());
        }
    }

    #[test]
    fn plain_timers_earn_nothing() {
        assert!(
            block_awards(UtcMs(4), FocusKind::Timer, FocusEnd::Completed, Some(100)).is_empty()
        );
    }

    #[test]
    fn award_keys_are_stable_and_distinct() {
        assert_eq!(
            Award::FocusCompleted { started: UtcMs(12) }.key(),
            "focus_completed:12"
        );
        assert_eq!(
            Award::FocusOnTarget { started: UtcMs(12) }.key(),
            "focus_on_target:12"
        );
        assert_eq!(
            Award::LimitRespected {
                goal: 7,
                day: 20_412
            }
            .key(),
            "limit_respected:7:20412"
        );
        assert_ne!(
            Award::GoalMet {
                goal: 7,
                day: 20_412
            }
            .key(),
            Award::GoalMet {
                goal: 7,
                day: 20_413
            }
            .key()
        );
    }

    #[test]
    fn sources_round_trip_by_name() {
        for source in Source::ALL {
            assert_eq!(Source::parse(source.as_str()), Some(source));
        }
        assert_eq!(Source::parse("bonus"), None);
    }

    #[test]
    fn grant_fills_up_to_the_cap_and_no_further() {
        assert_eq!(grant(0, 15), 15);
        assert_eq!(grant(95, 10), 5);
        assert_eq!(grant(100, 10), 0);
        assert_eq!(grant(140, 10), 0);
        assert!(!day_done(99));
        assert!(day_done(100));
    }

    #[test]
    fn levels_follow_the_table() {
        assert_eq!(level_for(0).level.name, LevelName::Start);
        assert_eq!(level_for(299).level.number, 1);
        assert_eq!(level_for(300).level.name, LevelName::Steady);
        let flow = level_for(2_410);
        assert_eq!(flow.level.name, LevelName::Flow);
        assert_eq!(flow.next.map(|l| l.name), Some(LevelName::Craft));
        assert_eq!((flow.into_level(), flow.span()), (410, Some(2_000)));
        let top = level_for(50_000);
        assert_eq!(top.level.name, LevelName::Kaizen);
        assert_eq!((top.next, top.span(), top.fraction()), (None, None, 1.0));
    }

    #[test]
    fn streak_counts_today_or_keeps_yesterday_alive() {
        let today = 100;
        assert_eq!(
            day_streak(&[98, 99, 100], today),
            DayStreak {
                current: 3,
                best: 3
            }
        );
        // Today has no strokes yet: the run up to yesterday still stands.
        assert_eq!(day_streak(&[97, 98, 99], today).current, 3);
        // A missed day ends the run, without hiding the best one.
        assert_eq!(
            day_streak(&[90, 91, 92, 93, 97], today),
            DayStreak {
                current: 0,
                best: 4
            }
        );
        assert_eq!(day_streak(&[], today), DayStreak::default());
    }

    #[test]
    fn streak_ignores_order_duplicates_and_future_days() {
        assert_eq!(
            day_streak(&[100, 99, 99, 101, 98], 100),
            DayStreak {
                current: 3,
                best: 3
            }
        );
    }

    #[test]
    fn seals_need_their_target_and_report_capped_progress() {
        let stats = SealStats {
            focus_completed: 12,
            breaks_taken: 0,
            best_streak: 12,
            best_full_run: 6,
        };
        assert_eq!(
            earned_seals(&stats),
            vec![Seal::FirstFocus, Seal::SevenDays, Seal::TenSessions]
        );
        assert_eq!(Seal::ThirtyDays.current(&stats), 12);
        assert_eq!(Seal::TenSessions.current(&stats), 10);
        assert!(!Seal::PerfectWeek.is_earned(&stats));
        assert!(earned_seals(&SealStats::default()).is_empty());
    }

    #[test]
    fn seals_round_trip_by_name_and_have_a_family() {
        for seal in Seal::ALL {
            assert_eq!(Seal::parse(seal.as_str()), Some(seal));
        }
        assert_eq!(Seal::PerfectWeek.family(), SealFamily::Goals);
        assert_eq!(Seal::TookTheBreak.family(), SealFamily::Breaks);
        assert_eq!(Seal::SevenDays.family().as_str(), "streaks");
    }

    proptest! {
        #[test]
        fn a_day_never_holds_more_than_the_cap(
            sources in proptest::collection::vec(0usize..Source::ALL.len(), 0..80),
        ) {
            let mut total = 0u32;
            for i in sources {
                let granted = grant(total, Source::ALL[i].strokes());
                prop_assert!(granted <= Source::ALL[i].strokes());
                total += granted;
                prop_assert!(total <= DAILY_CAP);
            }
        }

        #[test]
        fn level_progress_stays_inside_its_level(total in 0u64..40_000) {
            let progress = level_for(total);
            prop_assert!(total >= progress.level.min_strokes);
            if let Some(next) = progress.next {
                prop_assert!(total < next.min_strokes);
                prop_assert!(progress.into_level() < progress.span().unwrap_or(0));
            }
            prop_assert!((0.0..=1.0).contains(&progress.fraction()));
        }

        #[test]
        fn current_streak_never_exceeds_the_best(
            days in proptest::collection::vec(0i64..60, 0..60),
            today in 0i64..60,
        ) {
            let streak = day_streak(&days, today);
            prop_assert!(streak.current <= streak.best);
            prop_assert!(streak.best <= longest_run(&days));
        }
    }
}
