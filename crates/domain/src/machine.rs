//! Pure tracking state machine (design section 4): `on(event, now) -> Vec<Effect>`.
//!
//! The machine never reads a clock or touches I/O; the caller supplies `now`.
//! Segment ids belong to the repository, so effects close "the open segment".

use std::mem::discriminant;

use crate::focus::FocusSnapshot;
use crate::idle_gap::{IdleGap, clamp_since};
use crate::segment::EndReason;
use crate::time::UtcMs;

/// A gap between consecutive heartbeats above this means an unnotified suspend.
pub const HEARTBEAT_JUMP_MS: i64 = 60_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionState {
    Granted,
    Denied,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Start,
    Pause,
    Resume,
    Stop,
    PowerOff,
    /// Current focus after `apply_privacy`; `None` means excluded or unknown.
    Focus(Option<FocusSnapshot>),
    IdleDetected {
        since: UtcMs,
    },
    ActivityResumed,
    WillSleep,
    DidWake,
    ScreenLocked,
    ScreenUnlocked,
    Heartbeat,
    PermissionChanged(PermissionState),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    OpenSegment {
        at: UtcMs,
        focus: FocusSnapshot,
    },
    CloseSegment {
        at: UtcMs,
        reason: EndReason,
    },
    /// Refresh `heartbeat_at` of the open segment (R4.2).
    Heartbeat {
        at: UtcMs,
    },
    /// Persist a pending gap and announce `idle-gap-pending`.
    CreateGap(IdleGap),
    /// The status kind or `degraded` flag changed.
    StatusChanged,
    PermissionChanged(PermissionState),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResumeTo {
    Running,
    Paused,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenSegment {
    pub focus: FocusSnapshot,
    pub opened_at: UtcMs,
}

/// Idle time recorded while asleep; the gap is created on wake so its 10 min
/// expiry starts when the user can actually see the prompt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingGap {
    since: UtcMs,
    ended_at: UtcMs,
    prev_focus: Option<FocusSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum State {
    Stopped,
    /// `open` is `None` while the focused app is excluded or unknown.
    Running {
        open: Option<OpenSegment>,
        last_tick: UtcMs,
    },
    Paused,
    Idle {
        since: UtcMs,
        prev_focus: Option<FocusSnapshot>,
    },
    Asleep {
        sleeping: bool,
        locked: bool,
        resume_to: ResumeTo,
        pending_gap: Option<PendingGap>,
    },
}

#[derive(Debug, Clone)]
pub struct TrackingMachine {
    state: State,
    /// Latest focus seen in any state, so Start/Resume/wake open "with the current focus".
    focus: Option<FocusSnapshot>,
    degraded: bool,
    last_wake: Option<UtcMs>,
}

impl Default for TrackingMachine {
    fn default() -> Self {
        Self::new()
    }
}

impl TrackingMachine {
    pub fn new() -> Self {
        Self {
            state: State::Stopped,
            focus: None,
            degraded: false,
            last_wake: None,
        }
    }

    pub fn state(&self) -> &State {
        &self.state
    }

    pub fn is_degraded(&self) -> bool {
        self.degraded
    }

    pub fn has_open_segment(&self) -> bool {
        matches!(self.state, State::Running { open: Some(_), .. })
    }

    pub fn on(&mut self, event: Event, now: UtcMs) -> Vec<Effect> {
        let before = (discriminant(&self.state), self.degraded);
        let mut fx = Vec::new();
        match event {
            Event::PermissionChanged(permission) => {
                self.degraded = permission == PermissionState::Denied;
                fx.push(Effect::PermissionChanged(permission));
            }
            event => {
                if let Event::Focus(focus) = &event {
                    self.focus = focus.clone();
                }
                let state = std::mem::replace(&mut self.state, State::Stopped);
                self.state = self.transition(state, event, now, &mut fx);
            }
        }
        if before != (discriminant(&self.state), self.degraded) {
            fx.push(Effect::StatusChanged);
        }
        fx
    }

    fn transition(
        &mut self,
        state: State,
        event: Event,
        now: UtcMs,
        fx: &mut Vec<Effect>,
    ) -> State {
        use Event as E;
        use State as S;
        match (state, event) {
            (state, E::Stop) => stop(state, EndReason::Stop, now, fx),
            (state, E::PowerOff) => stop(state, EndReason::Shutdown, now, fx),

            (S::Stopped, E::Start) | (S::Paused, E::Resume) => self.run(now, fx),
            (S::Running { open, .. }, E::Pause) => {
                close(&open, now, EndReason::Pause, fx);
                S::Paused
            }
            (S::Idle { since, prev_focus }, E::Pause) => {
                push_gap(since, now, prev_focus, now, fx);
                S::Paused
            }

            (S::Running { open, last_tick }, E::Focus(_)) => {
                let same = match (&open, &self.focus) {
                    (Some(o), Some(f)) => o.focus.same_focus(f),
                    (None, None) => true,
                    _ => false,
                };
                if same {
                    S::Running {
                        open,
                        last_tick: now,
                    }
                } else {
                    close(&open, now, EndReason::FocusChange, fx);
                    let _ = last_tick;
                    self.run(now, fx)
                }
            }

            (S::Running { open, last_tick }, E::IdleDetected { since }) => {
                let floor = [self.last_wake, open.as_ref().map(|o| o.opened_at)]
                    .into_iter()
                    .flatten()
                    .max();
                let since = clamp_since(since, floor, now);
                close(&open, since, EndReason::Idle, fx);
                let _ = last_tick;
                S::Idle {
                    since,
                    prev_focus: open.map(|o| o.focus),
                }
            }
            (S::Idle { since, prev_focus }, E::ActivityResumed) => {
                push_gap(since, now, prev_focus, now, fx);
                self.run(now, fx)
            }

            (S::Running { open, .. }, e @ (E::WillSleep | E::ScreenLocked)) => {
                let reason = if e == E::WillSleep {
                    EndReason::Sleep
                } else {
                    EndReason::Lock
                };
                close(&open, now, reason, fx);
                asleep(e == E::WillSleep, ResumeTo::Running, None)
            }
            (S::Idle { since, prev_focus }, e @ (E::WillSleep | E::ScreenLocked)) => {
                let pending = PendingGap {
                    since,
                    ended_at: now,
                    prev_focus,
                };
                asleep(e == E::WillSleep, ResumeTo::Running, Some(pending))
            }
            (S::Paused, e @ (E::WillSleep | E::ScreenLocked)) => {
                asleep(e == E::WillSleep, ResumeTo::Paused, None)
            }

            (
                S::Asleep {
                    sleeping,
                    locked,
                    resume_to,
                    pending_gap,
                },
                event,
            ) => {
                let (mut sleeping, mut locked, mut resume_to) = (sleeping, locked, resume_to);
                match event {
                    E::WillSleep => sleeping = true,
                    E::ScreenLocked => locked = true,
                    E::DidWake => sleeping = false,
                    E::ScreenUnlocked => locked = false,
                    E::Pause => resume_to = ResumeTo::Paused,
                    E::Resume => resume_to = ResumeTo::Running,
                    // Unlock fallback: user input implies unlock when not sleeping.
                    E::ActivityResumed | E::Focus(_) if !sleeping => locked = false,
                    _ => {}
                }
                if sleeping || locked {
                    return S::Asleep {
                        sleeping,
                        locked,
                        resume_to,
                        pending_gap,
                    };
                }
                self.last_wake = Some(now);
                if let Some(p) = pending_gap {
                    push_gap(p.since, p.ended_at, p.prev_focus, now, fx);
                }
                match resume_to {
                    ResumeTo::Running => self.run(now, fx),
                    ResumeTo::Paused => S::Paused,
                }
            }

            (S::Running { open, last_tick }, E::Heartbeat) => {
                if now.since(last_tick) > HEARTBEAT_JUMP_MS {
                    // Unnotified suspend: close at the last tick and reopen now.
                    self.last_wake = Some(now);
                    close(&open, last_tick, EndReason::Sleep, fx);
                    let open = open.map(|o| {
                        fx.push(Effect::OpenSegment {
                            at: now,
                            focus: o.focus.clone(),
                        });
                        OpenSegment {
                            focus: o.focus,
                            opened_at: now,
                        }
                    });
                    S::Running {
                        open,
                        last_tick: now,
                    }
                } else {
                    if open.is_some() {
                        fx.push(Effect::Heartbeat { at: now });
                    }
                    S::Running {
                        open,
                        last_tick: now,
                    }
                }
            }

            // Ignored: Focus/IdleDetected while Paused/Idle/Stopped, and no-op repeats.
            (state, _) => state,
        }
    }

    /// Enter `Running`, opening a segment with the current focus if there is one.
    fn run(&self, now: UtcMs, fx: &mut Vec<Effect>) -> State {
        let open = self.focus.clone().map(|focus| {
            fx.push(Effect::OpenSegment {
                at: now,
                focus: focus.clone(),
            });
            OpenSegment {
                focus,
                opened_at: now,
            }
        });
        State::Running {
            open,
            last_tick: now,
        }
    }
}

fn close(open: &Option<OpenSegment>, at: UtcMs, reason: EndReason, fx: &mut Vec<Effect>) {
    if open.is_some() {
        fx.push(Effect::CloseSegment { at, reason });
    }
}

fn stop(state: State, reason: EndReason, now: UtcMs, fx: &mut Vec<Effect>) -> State {
    // Stopping from Idle/Asleep drops any unprompted idle time.
    if let State::Running { open, .. } = state {
        close(&open, now, reason, fx);
    }
    State::Stopped
}

fn asleep(sleeping: bool, resume_to: ResumeTo, pending_gap: Option<PendingGap>) -> State {
    State::Asleep {
        sleeping,
        locked: !sleeping,
        resume_to,
        pending_gap,
    }
}

fn push_gap(
    since: UtcMs,
    ended_at: UtcMs,
    prev_focus: Option<FocusSnapshot>,
    shown_at: UtcMs,
    fx: &mut Vec<Effect>,
) {
    if ended_at > since {
        fx.push(Effect::CreateGap(IdleGap::pending(
            since, ended_at, prev_focus, shown_at,
        )));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::idle_gap::{DEFAULT_IDLE_PROMPT_TIMEOUT_MS, GapStatus};

    fn f(app: &str) -> FocusSnapshot {
        FocusSnapshot {
            app_id: format!("com.{app}"),
            app_name: app.into(),
            pid: 1,
            window_title: None,
        }
    }

    fn t(secs: i64) -> UtcMs {
        UtcMs(secs * 1_000)
    }

    fn open(app: &str, at: i64) -> Effect {
        Effect::OpenSegment {
            at: t(at),
            focus: f(app),
        }
    }

    fn close_fx(at: i64, reason: EndReason) -> Effect {
        Effect::CloseSegment { at: t(at), reason }
    }

    /// Machine already running on app `a` since t=0.
    fn running() -> TrackingMachine {
        let mut m = TrackingMachine::new();
        m.on(Event::Focus(Some(f("a"))), t(0));
        m.on(Event::Start, t(0));
        m
    }

    fn without_status(fx: Vec<Effect>) -> Vec<Effect> {
        fx.into_iter()
            .filter(|e| *e != Effect::StatusChanged)
            .collect()
    }

    #[test]
    fn start_opens_with_current_focus_or_waits_for_one() {
        let mut m = TrackingMachine::new();
        m.on(Event::Focus(Some(f("a"))), t(0));
        assert_eq!(
            m.on(Event::Start, t(1)),
            vec![open("a", 1), Effect::StatusChanged]
        );

        let mut m = TrackingMachine::new();
        assert_eq!(m.on(Event::Start, t(1)), vec![Effect::StatusChanged]);
        assert!(!m.has_open_segment());
        assert_eq!(m.on(Event::Focus(Some(f("b"))), t(2)), vec![open("b", 2)]);
    }

    #[test]
    fn focus_change_closes_90s_segment_and_opens_next() {
        let mut m = running();
        assert_eq!(
            m.on(Event::Focus(Some(f("b"))), t(90)),
            vec![close_fx(90, EndReason::FocusChange), open("b", 90)]
        );
    }

    #[test]
    fn same_focus_and_title_change_rules() {
        let mut m = running();
        assert!(m.on(Event::Focus(Some(f("a"))), t(5)).is_empty());
        let mut titled = f("a");
        titled.window_title = Some("doc".into());
        let fx = m.on(Event::Focus(Some(titled.clone())), t(6));
        assert_eq!(fx[0], close_fx(6, EndReason::FocusChange));
        assert_eq!(
            fx[1],
            Effect::OpenSegment {
                at: t(6),
                focus: titled
            }
        );
    }

    #[test]
    fn excluded_focus_closes_and_later_focus_reopens() {
        let mut m = running();
        assert_eq!(
            m.on(Event::Focus(None), t(10)),
            vec![close_fx(10, EndReason::FocusChange)]
        );
        assert!(!m.has_open_segment());
        assert_eq!(m.on(Event::Heartbeat, t(12)), vec![]);
        assert_eq!(m.on(Event::Focus(Some(f("b"))), t(20)), vec![open("b", 20)]);
    }

    #[test]
    fn pause_ignores_focus_and_resume_uses_latest_focus() {
        let mut m = running();
        assert_eq!(
            m.on(Event::Pause, t(10)),
            vec![close_fx(10, EndReason::Pause), Effect::StatusChanged]
        );
        assert!(m.on(Event::Focus(Some(f("b"))), t(11)).is_empty());
        assert!(m.on(Event::IdleDetected { since: t(11) }, t(12)).is_empty());
        assert_eq!(
            m.on(Event::Resume, t(20)),
            vec![open("b", 20), Effect::StatusChanged]
        );
    }

    #[test]
    fn idle_closes_retroactively_then_activity_creates_pending_gap() {
        let mut m = running();
        assert_eq!(
            m.on(Event::IdleDetected { since: t(100) }, t(400)),
            vec![close_fx(100, EndReason::Idle), Effect::StatusChanged]
        );
        let fx = m.on(Event::ActivityResumed, t(700));
        let Effect::CreateGap(gap) = &fx[0] else {
            panic!("expected gap, got {fx:?}")
        };
        assert_eq!((gap.started_at, gap.ended_at), (t(100), t(700)));
        assert_eq!(gap.status, GapStatus::Pending);
        assert_eq!(
            gap.expires_at,
            t(700).plus_ms(DEFAULT_IDLE_PROMPT_TIMEOUT_MS)
        );
        assert_eq!(gap.prev_focus, Some(f("a")));
        assert_eq!(fx[1], open("a", 700));
    }

    #[test]
    fn idle_since_is_clamped_to_segment_start_and_now() {
        let mut m = running();
        m.on(Event::Focus(Some(f("b"))), t(50));
        let fx = m.on(Event::IdleDetected { since: t(10) }, t(60));
        assert_eq!(fx[0], close_fx(50, EndReason::Idle));
        let mut m = running();
        let fx = m.on(Event::IdleDetected { since: t(900) }, t(60));
        assert_eq!(fx[0], close_fx(60, EndReason::Idle));
    }

    #[test]
    fn idle_since_is_clamped_to_wake_time() {
        let mut m = running();
        m.on(Event::WillSleep, t(10));
        m.on(Event::DidWake, t(1_000));
        m.on(Event::ScreenUnlocked, t(1_000)); // no-op: not locked
        let fx = m.on(Event::IdleDetected { since: t(500) }, t(1_400));
        assert_eq!(fx[0], close_fx(1_000, EndReason::Idle));
    }

    #[test]
    fn running_sleep_and_lock_close_with_matching_reason() {
        for (ev, reason) in [
            (Event::WillSleep, EndReason::Sleep),
            (Event::ScreenLocked, EndReason::Lock),
        ] {
            let mut m = running();
            assert_eq!(without_status(m.on(ev, t(30))), vec![close_fx(30, reason)]);
        }
    }

    #[test]
    fn asleep_needs_both_flags_clear_before_reopening() {
        let mut m = running();
        m.on(Event::WillSleep, t(10));
        m.on(Event::ScreenLocked, t(11));
        assert!(m.on(Event::DidWake, t(20)).is_empty(), "still locked");
        // Lock still held; only the unlock event (or input fallback) releases it.
        assert!(matches!(
            m.state(),
            State::Asleep {
                sleeping: false,
                locked: true,
                ..
            }
        ));
        assert_eq!(
            m.on(Event::ScreenUnlocked, t(21)),
            vec![open("a", 21), Effect::StatusChanged]
        );
    }

    #[test]
    fn wake_then_unlock_reopens_with_current_focus() {
        let mut m = running();
        m.on(Event::WillSleep, t(10));
        m.on(Event::ScreenLocked, t(11));
        m.on(Event::Focus(Some(f("b"))), t(12)); // ignored while sleeping
        assert!(m.on(Event::ScreenUnlocked, t(20)).is_empty());
        assert_eq!(
            m.on(Event::DidWake, t(21)),
            vec![open("b", 21), Effect::StatusChanged]
        );
    }

    #[test]
    fn paused_sleep_wake_returns_to_paused_without_segments() {
        let mut m = running();
        m.on(Event::Pause, t(5));
        m.on(Event::WillSleep, t(10));
        assert!(matches!(
            m.state(),
            State::Asleep {
                resume_to: ResumeTo::Paused,
                ..
            }
        ));
        assert_eq!(without_status(m.on(Event::DidWake, t(500))), vec![]);
        assert_eq!(*m.state(), State::Paused);
        assert_eq!(
            without_status(m.on(Event::Focus(Some(f("b"))), t(501))),
            vec![]
        );
    }

    #[test]
    fn idle_then_lock_defers_gap_to_unlock() {
        let mut m = running();
        m.on(Event::IdleDetected { since: t(100) }, t(400));
        assert!(without_status(m.on(Event::ScreenLocked, t(420))).is_empty());
        let fx = m.on(Event::ScreenUnlocked, t(5_000));
        let Effect::CreateGap(gap) = &fx[0] else {
            panic!("expected gap, got {fx:?}")
        };
        assert_eq!((gap.started_at, gap.ended_at), (t(100), t(420)));
        assert_eq!(
            gap.expires_at,
            t(5_000).plus_ms(DEFAULT_IDLE_PROMPT_TIMEOUT_MS)
        );
        assert_eq!(fx[1], open("a", 5_000));
    }

    #[test]
    fn unlock_fallback_on_input_when_not_sleeping() {
        for ev in [Event::ActivityResumed, Event::Focus(Some(f("a")))] {
            let mut m = running();
            m.on(Event::ScreenLocked, t(10));
            assert_eq!(m.on(ev, t(20)), vec![open("a", 20), Effect::StatusChanged]);
        }
        // While sleeping, input does not clear the lock.
        let mut m = running();
        m.on(Event::WillSleep, t(10));
        m.on(Event::ScreenLocked, t(11));
        assert!(m.on(Event::ActivityResumed, t(12)).is_empty());
    }

    /// The macOS sampler reports the lock screen (`loginwindow` in front) as `ScreenLocked`
    /// and, on leaving it, the next app's focus followed by `ScreenUnlocked`; together with
    /// the OS notifications (duplicates included) no segment is opened while locked.
    #[test]
    fn lock_screen_sequence_from_the_sampler_tracks_nothing_while_locked() {
        let mut m = running();
        let fx = without_status(m.on(Event::ScreenLocked, t(10)));
        assert_eq!(fx, vec![close_fx(10, EndReason::Lock)]);
        // The OS notification arrives as well: still locked, nothing opens.
        assert!(without_status(m.on(Event::ScreenLocked, t(11))).is_empty());
        assert!(without_status(m.on(Event::Heartbeat, t(600))).is_empty());
        let fx = without_status(m.on(Event::Focus(Some(f("b"))), t(8_000)));
        assert_eq!(fx, vec![open("b", 8_000)]);
        assert!(without_status(m.on(Event::ScreenUnlocked, t(8_000))).is_empty());
        assert!(without_status(m.on(Event::ScreenUnlocked, t(8_001))).is_empty());
    }

    #[test]
    fn heartbeat_jump_closes_at_last_tick_and_reopens() {
        let mut m = running();
        assert_eq!(
            m.on(Event::Heartbeat, t(2)),
            vec![Effect::Heartbeat { at: t(2) }]
        );
        assert_eq!(
            m.on(Event::Heartbeat, t(62)),
            vec![Effect::Heartbeat { at: t(62) }],
            "60 s is not a jump"
        );
        assert_eq!(
            m.on(Event::Heartbeat, t(200)),
            vec![close_fx(62, EndReason::Sleep), open("a", 200)]
        );
    }

    #[test]
    fn stop_and_power_off_close_with_their_reasons() {
        let mut m = running();
        assert_eq!(
            without_status(m.on(Event::Stop, t(9))),
            vec![close_fx(9, EndReason::Stop)]
        );
        assert_eq!(*m.state(), State::Stopped);
        let mut m = running();
        assert_eq!(
            without_status(m.on(Event::PowerOff, t(9))),
            vec![close_fx(9, EndReason::Shutdown)]
        );
        let mut m = running();
        m.on(Event::Pause, t(1));
        assert_eq!(without_status(m.on(Event::Stop, t(2))), vec![]);
    }

    #[test]
    fn permission_change_toggles_degraded_in_any_state() {
        let mut m = TrackingMachine::new();
        assert_eq!(
            m.on(Event::PermissionChanged(PermissionState::Denied), t(1)),
            vec![
                Effect::PermissionChanged(PermissionState::Denied),
                Effect::StatusChanged
            ]
        );
        assert!(m.is_degraded());
        assert_eq!(
            m.on(Event::PermissionChanged(PermissionState::Granted), t(2)),
            vec![
                Effect::PermissionChanged(PermissionState::Granted),
                Effect::StatusChanged
            ]
        );
        assert!(!m.is_degraded());
    }
}
