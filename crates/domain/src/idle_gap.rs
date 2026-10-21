use crate::focus::FocusSnapshot;
use crate::segment::{ActivityId, IdleResolution};
use crate::time::UtcMs;

/// Default time the user has to answer the idle prompt (`idle_prompt_timeout_secs=600`).
pub const DEFAULT_IDLE_PROMPT_TIMEOUT_MS: i64 = 600_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct GapId(pub i64);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GapStatus {
    Pending,
    Resolved(IdleResolution),
    /// Treated as `Discard` (R1.6).
    Expired,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdleGap {
    /// `None` until the repository assigns one.
    pub id: Option<GapId>,
    pub started_at: UtcMs,
    pub ended_at: UtcMs,
    pub prev_focus: Option<FocusSnapshot>,
    pub status: GapStatus,
    pub expires_at: UtcMs,
}

/// Time to persist as an `IdleAssigned` segment (design section 3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssignedSpan {
    pub started_at: UtcMs,
    pub ended_at: UtcMs,
    /// All three are `None` for `AssignActivity` (amendment A1).
    pub app_id: Option<String>,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub activity_id: Option<ActivityId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GapError {
    NotPending,
}

impl IdleGap {
    /// A new pending gap; the expiry clock starts when the prompt is shown (`shown_at`).
    pub fn pending(
        started_at: UtcMs,
        ended_at: UtcMs,
        prev_focus: Option<FocusSnapshot>,
        shown_at: UtcMs,
    ) -> Self {
        Self {
            id: None,
            started_at,
            ended_at,
            prev_focus,
            status: GapStatus::Pending,
            expires_at: shown_at.plus_ms(DEFAULT_IDLE_PROMPT_TIMEOUT_MS),
        }
    }

    pub fn is_due(&self, now: UtcMs) -> bool {
        self.status == GapStatus::Pending && now >= self.expires_at
    }

    /// Marks a due pending gap as expired; returns whether it changed.
    pub fn expire_if_due(&mut self, now: UtcMs) -> bool {
        let due = self.is_due(now);
        if due {
            self.status = GapStatus::Expired;
        }
        due
    }

    /// Applies the user decision. `Ok(None)` means nothing to persist (discard, or
    /// `AssignPrevious` with no previous focus to attribute the time to).
    pub fn resolve(
        &mut self,
        resolution: IdleResolution,
    ) -> Result<Option<AssignedSpan>, GapError> {
        if self.status != GapStatus::Pending {
            return Err(GapError::NotPending);
        }
        self.status = GapStatus::Resolved(resolution);
        let span = |focus: Option<&FocusSnapshot>, activity_id| AssignedSpan {
            started_at: self.started_at,
            ended_at: self.ended_at,
            app_id: focus.map(|f| f.app_id.clone()),
            app_name: focus.map(|f| f.app_name.clone()),
            window_title: focus.and_then(|f| f.window_title.clone()),
            activity_id,
        };
        Ok(match resolution {
            IdleResolution::Discard => None,
            IdleResolution::AssignPrevious => self.prev_focus.as_ref().map(|f| span(Some(f), None)),
            IdleResolution::AssignActivity(id) => Some(span(None, Some(id))),
        })
    }
}

/// Bounds an idle `since` to `[floor, now]`; `floor` is the last wake/unlock or the
/// time the open segment started, whichever is later.
pub fn clamp_since(since: UtcMs, floor: Option<UtcMs>, now: UtcMs) -> UtcMs {
    let lower = floor.map_or(since, |f| since.max(f));
    lower.min(now)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::machine::{Effect, Event, PermissionState, TrackingMachine};
    use proptest::prelude::*;

    fn focus(app: &str, title: Option<&str>) -> FocusSnapshot {
        FocusSnapshot {
            app_id: format!("com.{app}"),
            app_name: app.into(),
            pid: 1,
            window_title: title.map(Into::into),
        }
    }

    fn gap() -> IdleGap {
        IdleGap::pending(
            UtcMs(1_000),
            UtcMs(21_000),
            Some(focus("a", Some("t"))),
            UtcMs(21_000),
        )
    }

    #[test]
    fn expires_ten_minutes_after_it_is_shown() {
        let mut g = gap();
        assert_eq!(g.expires_at, UtcMs(621_000));
        assert!(!g.expire_if_due(UtcMs(620_999)));
        assert!(g.expire_if_due(UtcMs(621_000)));
        assert_eq!(g.status, GapStatus::Expired);
        assert!(!g.expire_if_due(UtcMs(900_000)), "already expired");
        assert_eq!(
            g.resolve(IdleResolution::Discard),
            Err(GapError::NotPending)
        );
    }

    #[test]
    fn discard_persists_nothing() {
        let mut g = gap();
        assert_eq!(g.resolve(IdleResolution::Discard), Ok(None));
        assert_eq!(g.status, GapStatus::Resolved(IdleResolution::Discard));
        assert_eq!(
            g.resolve(IdleResolution::Discard),
            Err(GapError::NotPending)
        );
    }

    #[test]
    fn assign_previous_copies_prev_focus() {
        let span = gap()
            .resolve(IdleResolution::AssignPrevious)
            .unwrap()
            .unwrap();
        assert_eq!(span.app_id.as_deref(), Some("com.a"));
        assert_eq!(span.window_title.as_deref(), Some("t"));
        assert_eq!(
            (span.started_at, span.ended_at),
            (UtcMs(1_000), UtcMs(21_000))
        );
        assert_eq!(span.activity_id, None);

        let mut no_prev = gap();
        no_prev.prev_focus = None;
        assert_eq!(no_prev.resolve(IdleResolution::AssignPrevious), Ok(None));
    }

    #[test]
    fn assign_activity_has_null_app() {
        let span = gap()
            .resolve(IdleResolution::AssignActivity(ActivityId(7)))
            .unwrap()
            .unwrap();
        assert_eq!(
            (span.app_id, span.app_name, span.window_title),
            (None, None, None)
        );
        assert_eq!(span.activity_id, Some(ActivityId(7)));
    }

    #[test]
    fn clamp_bounds_since_between_floor_and_now() {
        assert_eq!(clamp_since(UtcMs(5), Some(UtcMs(9)), UtcMs(20)), UtcMs(9));
        assert_eq!(clamp_since(UtcMs(15), Some(UtcMs(9)), UtcMs(20)), UtcMs(15));
        assert_eq!(clamp_since(UtcMs(50), None, UtcMs(20)), UtcMs(20));
        assert_eq!(clamp_since(UtcMs(5), None, UtcMs(20)), UtcMs(5));
    }

    fn event() -> impl Strategy<Value = Event> {
        prop_oneof![
            Just(Event::Start),
            Just(Event::Pause),
            Just(Event::Resume),
            Just(Event::Stop),
            Just(Event::PowerOff),
            Just(Event::Focus(None)),
            Just(Event::Focus(Some(focus("a", None)))),
            Just(Event::Focus(Some(focus("a", Some("t"))))),
            Just(Event::Focus(Some(focus("b", None)))),
            (0i64..400_000).prop_map(|ago| Event::IdleDetected { since: UtcMs(ago) }),
            Just(Event::ActivityResumed),
            Just(Event::WillSleep),
            Just(Event::DidWake),
            Just(Event::ScreenLocked),
            Just(Event::ScreenUnlocked),
            Just(Event::Heartbeat),
            Just(Event::PermissionChanged(PermissionState::Denied)),
        ]
    }

    proptest! {
        /// R1.3: at most one open segment, effects stay consistent with machine state,
        /// and every closed segment has a non-negative duration.
        #[test]
        fn at_most_one_open_segment(steps in prop::collection::vec((event(), 0i64..200_000), 0..80)) {
            let mut machine = TrackingMachine::new();
            let (mut now, mut open_since): (i64, Option<i64>) = (1_000_000, None);
            for (ev, dt) in steps {
                now += dt;
                let ev = match ev {
                    // Make `since` relative so it is plausibly in the past.
                    Event::IdleDetected { since } => Event::IdleDetected { since: UtcMs(now - since.0) },
                    other => other,
                };
                for fx in machine.on(ev, UtcMs(now)) {
                    match fx {
                        Effect::OpenSegment { at, .. } => {
                            prop_assert!(open_since.is_none(), "opened while one is open");
                            open_since = Some(at.0);
                        }
                        Effect::CloseSegment { at, .. } => {
                            let start = open_since.take();
                            prop_assert!(start.is_some(), "closed with none open");
                            prop_assert!(at.0 >= start.unwrap(), "negative duration");
                        }
                        _ => {}
                    }
                }
                prop_assert_eq!(open_since.is_some(), machine.has_open_segment());
            }
        }
    }
}
