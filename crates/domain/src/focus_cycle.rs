//! The pomodoro cycle around focus blocks: focus, short break, focus... and a long break every
//! few work blocks. Pure: the caller says what happened (a block started, completed, was
//! cancelled) and what the user chose on the end card; this module keeps the count and decides
//! what comes next.
//!
//! When a block runs its course an end card waits for the user ("Focus done, take a 5-minute
//! break?"). Its three answers: start what comes next, skip it, or take a few more minutes of
//! the same block. More minutes keep the offer: when they are over, the same next step is
//! offered again and the round is not counted twice.

use crate::UtcMs;
use crate::focus_session::{Allowed, FocusKind};

/// A cycle left alone this long starts over at the first round.
pub const CYCLE_RESET_MS: i64 = 2 * 3_600_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CycleConfig {
    /// Offer breaks between work blocks.
    pub enabled: bool,
    pub short_break_ms: i64,
    pub long_break_ms: i64,
    /// A long break after this many work blocks (at least 1).
    pub long_every: u32,
}

impl Default for CycleConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            short_break_ms: 5 * 60_000,
            long_break_ms: 15 * 60_000,
            long_every: 4,
        }
    }
}

/// A block to start: what the end card offers, or what the user asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
    pub kind: FocusKind,
    pub planned_ms: i64,
    pub intent: String,
    pub allowed: Allowed,
    /// A long break (it closes the cycle).
    pub long_break: bool,
}

/// The card shown when a block ran its course, until the user answers it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EndCard {
    /// The block that ended.
    pub finished: Step,
    pub at: UtcMs,
    /// What comes next; `None` when the cycle is off.
    pub next: Option<Step>,
}

/// The user's answer to the end card.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardAction {
    StartNext,
    Skip,
    /// A few more minutes of the block that ended.
    MoreTime {
        ms: i64,
    },
}

/// Where the cycle stands; stored between runs of the app.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Cycle {
    /// Work blocks completed in this cycle, `0..=long_every`.
    pub round: u32,
    /// The last work block started: what a break leads back to.
    pub last_work: Option<Step>,
    pub last_end_at: Option<UtcMs>,
    pub card: Option<EndCard>,
    /// The running block is "more time" for a card whose offer waits until it ends.
    pub continuing: bool,
    pub deferred: Option<Step>,
    /// The running block is a long break.
    pub long_break_running: bool,
}

impl Cycle {
    /// A block started from scratch (not from the end card's "more time").
    pub fn started(&mut self, step: Step, now: UtcMs) {
        let stale = self
            .last_end_at
            .is_some_and(|at| now.since(at) >= CYCLE_RESET_MS);
        if stale {
            self.round = 0;
        }
        self.card = None;
        self.continuing = false;
        self.deferred = None;
        self.long_break_running = step.kind == FocusKind::Break && step.long_break;
        if step.kind.is_work() {
            self.last_work = Some(Step {
                long_break: false,
                ..step
            });
        }
    }

    /// The running block ran its course; returns the card to show.
    pub fn completed(&mut self, finished: Step, at: UtcMs, config: &CycleConfig) -> &EndCard {
        let every = config.long_every.max(1);
        let next = if self.continuing {
            self.deferred.take()
        } else if finished.kind.is_work() {
            self.round = (self.round + 1).min(every);
            let long = self.round >= every;
            config.enabled.then(|| Step {
                kind: FocusKind::Break,
                planned_ms: if long {
                    config.long_break_ms
                } else {
                    config.short_break_ms
                },
                intent: String::new(),
                allowed: Allowed::default(),
                long_break: long,
            })
        } else {
            if self.long_break_running {
                self.round = 0;
            }
            if config.enabled {
                self.last_work.clone()
            } else {
                None
            }
        };
        self.continuing = false;
        self.long_break_running = false;
        self.last_end_at = Some(at);
        self.card.insert(EndCard { finished, at, next })
    }

    /// The user ended the running block early: no card, the round is not counted.
    pub fn cancelled(&mut self, at: UtcMs) {
        self.card = None;
        self.continuing = false;
        self.deferred = None;
        self.long_break_running = false;
        self.last_end_at = Some(at);
    }

    /// Answers the end card; returns the block to start, if any. `None` without a card.
    pub fn answer(&mut self, action: CardAction, now: UtcMs) -> Option<Step> {
        let card = self.card.take()?;
        match action {
            CardAction::StartNext => {
                let next = card.next?;
                self.started(next.clone(), now);
                Some(next)
            }
            CardAction::Skip => {
                // Skipping the long break still closes the cycle.
                if card.next.as_ref().is_some_and(|n| n.long_break) {
                    self.round = 0;
                }
                self.last_end_at = Some(now);
                None
            }
            CardAction::MoreTime { ms } => {
                self.continuing = true;
                self.deferred = card.next;
                self.long_break_running =
                    card.finished.kind == FocusKind::Break && card.finished.long_break;
                Some(Step {
                    planned_ms: ms,
                    ..card.finished
                })
            }
        }
    }

    /// Takes the card's next step right away (auto-start); `None` when there is none.
    pub fn auto_start(&mut self, now: UtcMs) -> Option<Step> {
        self.card.as_ref()?.next.as_ref()?;
        self.answer(CardAction::StartNext, now)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = 60_000;

    fn work(minutes: i64) -> Step {
        Step {
            kind: FocusKind::Timer,
            planned_ms: minutes * MIN,
            intent: "Write report".into(),
            allowed: Allowed::default(),
            long_break: false,
        }
    }

    /// Runs one work block to completion at `at` minutes; returns the next step offered.
    fn complete_work(c: &mut Cycle, at: i64, config: &CycleConfig) -> Option<Step> {
        c.started(work(25), UtcMs(at * MIN - 25 * MIN));
        c.completed(work(25), UtcMs(at * MIN), config).next.clone()
    }

    #[test]
    fn a_work_block_offers_a_short_break_and_counts_the_round() {
        let config = CycleConfig::default();
        let mut c = Cycle::default();
        let next = complete_work(&mut c, 25, &config).unwrap();
        assert_eq!((next.kind, next.planned_ms), (FocusKind::Break, 5 * MIN));
        assert!(!next.long_break);
        assert_eq!(c.round, 1);
        assert_eq!(c.card.as_ref().unwrap().finished.intent, "Write report");
    }

    #[test]
    fn every_fourth_block_offers_a_long_break_that_closes_the_cycle() {
        let config = CycleConfig::default();
        let mut c = Cycle::default();
        for round in 1..=3 {
            complete_work(&mut c, 30 * round, &config);
            let brk = c
                .answer(CardAction::StartNext, UtcMs(30 * round * MIN))
                .unwrap();
            assert!(!brk.long_break);
            let back = c.completed(brk, UtcMs((30 * round + 5) * MIN), &config);
            // A break leads back to the last work block.
            assert_eq!(back.next.as_ref().unwrap().kind, FocusKind::Timer);
            c.answer(CardAction::Skip, UtcMs((30 * round + 5) * MIN));
        }
        assert_eq!(c.round, 3);
        let long = complete_work(&mut c, 120, &config).unwrap();
        assert!(long.long_break);
        assert_eq!(long.planned_ms, 15 * MIN);
        assert_eq!(c.round, 4);
        let brk = c.answer(CardAction::StartNext, UtcMs(120 * MIN)).unwrap();
        assert_eq!(c.round, 4, "the dots stay full during the long break");
        c.completed(brk, UtcMs(135 * MIN), &config);
        assert_eq!(c.round, 0);
    }

    #[test]
    fn skipping_the_long_break_also_starts_over() {
        let config = CycleConfig {
            long_every: 1,
            ..CycleConfig::default()
        };
        let mut c = Cycle::default();
        assert!(complete_work(&mut c, 25, &config).unwrap().long_break);
        assert_eq!(c.answer(CardAction::Skip, UtcMs(26 * MIN)), None);
        assert_eq!(c.round, 0);
        assert!(c.card.is_none());
    }

    #[test]
    fn more_time_keeps_the_offer_and_does_not_count_twice() {
        let config = CycleConfig::default();
        let mut c = Cycle::default();
        complete_work(&mut c, 25, &config);
        let more = c
            .answer(CardAction::MoreTime { ms: 5 * MIN }, UtcMs(25 * MIN))
            .unwrap();
        assert_eq!((more.kind, more.planned_ms), (FocusKind::Timer, 5 * MIN));
        assert_eq!(more.intent, "Write report");
        let card = c.completed(more, UtcMs(30 * MIN), &config);
        assert_eq!(card.next.as_ref().unwrap().kind, FocusKind::Break);
        assert_eq!(c.round, 1);
    }

    #[test]
    fn without_the_cycle_the_card_offers_nothing_next() {
        let config = CycleConfig {
            enabled: false,
            ..CycleConfig::default()
        };
        let mut c = Cycle::default();
        assert_eq!(complete_work(&mut c, 25, &config), None);
        assert!(c.card.is_some(), "the card still says the time is up");
        assert_eq!(c.answer(CardAction::StartNext, UtcMs(26 * MIN)), None);
        assert_eq!(c.auto_start(UtcMs(26 * MIN)), None);
    }

    #[test]
    fn auto_start_takes_the_next_step() {
        let config = CycleConfig::default();
        let mut c = Cycle::default();
        complete_work(&mut c, 25, &config);
        let brk = c.auto_start(UtcMs(25 * MIN)).unwrap();
        assert_eq!(brk.kind, FocusKind::Break);
        assert!(c.card.is_none());
    }

    #[test]
    fn cancelling_shows_no_card_and_counts_nothing() {
        let config = CycleConfig::default();
        let mut c = Cycle::default();
        c.started(work(25), UtcMs(0));
        c.cancelled(UtcMs(10 * MIN));
        assert!(c.card.is_none());
        assert_eq!(c.round, 0);
        complete_work(&mut c, 40, &config);
        assert_eq!(c.round, 1);
    }

    #[test]
    fn a_cycle_left_alone_for_hours_starts_over() {
        let config = CycleConfig::default();
        let mut c = Cycle::default();
        complete_work(&mut c, 25, &config);
        complete_work(&mut c, 60, &config);
        assert_eq!(c.round, 2);
        c.card = None;
        c.started(work(25), UtcMs(60 * MIN + CYCLE_RESET_MS));
        assert_eq!(c.round, 0);
    }
}
