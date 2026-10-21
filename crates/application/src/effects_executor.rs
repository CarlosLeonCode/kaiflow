//! Maps the domain machine's effects to repository, sink and notifier calls.
//!
//! The machine holds no segment ids and no gap state beyond what it emits, so this
//! executor owns the in-memory list of pending gaps and the expiry rules (R1.6, R3.4).

use domain::{
    DEFAULT_IDLE_PROMPT_TIMEOUT_MS, Effect, GapId, GapStatus, IdleGap, IdleResolution,
    PermissionState, UtcMs,
};

use crate::idle_policy::IdlePolicy;
use crate::ports::{
    DataKind, DomainEvent, EventSink, Notifier, PortError, SessionRepository, TrackingStatus,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveError {
    /// Unknown id, or the gap was already resolved or expired.
    NotFound,
    /// The 10 minute window elapsed before the answer arrived.
    Expired,
    Storage(PortError),
}

pub struct EffectsExecutor {
    sessions: Box<dyn SessionRepository>,
    sink: Box<dyn EventSink>,
    notifier: Box<dyn Notifier>,
    pending: Vec<IdleGap>,
    revocation_notified: bool,
    /// Read on every gap so settings changes apply without a restart.
    policy: IdlePolicy,
}

impl EffectsExecutor {
    pub fn new(
        sessions: Box<dyn SessionRepository>,
        sink: Box<dyn EventSink>,
        notifier: Box<dyn Notifier>,
        policy: IdlePolicy,
    ) -> Self {
        Self {
            sessions,
            sink,
            notifier,
            pending: Vec::new(),
            revocation_notified: false,
            policy,
        }
    }

    pub fn pending_gaps(&self) -> &[IdleGap] {
        &self.pending
    }

    /// Reports a failed call without stopping the engine.
    pub fn report(&self, error: PortError) {
        self.sink.emit(DomainEvent::StorageFailed(error.0));
    }

    /// Startup recovery (R4.3, S1): close orphans at their last heartbeat and expire
    /// every gap left pending by the previous run.
    pub fn recover(&mut self, now: UtcMs) {
        match self.sessions.recover_orphans() {
            Ok(0) => {}
            Ok(_) => self.sink.emit(DomainEvent::DataChanged(DataKind::Segments)),
            Err(e) => self.report(e),
        }
        match self.sessions.pending_gaps() {
            Ok(gaps) => {
                let any = !gaps.is_empty();
                for gap in gaps {
                    self.expire(gap, now);
                }
                if any {
                    self.sink.emit(DomainEvent::DataChanged(DataKind::Gaps));
                }
            }
            Err(e) => self.report(e),
        }
    }

    /// Runs one batch of machine effects; `status` is the machine status after them.
    pub fn execute(&mut self, effects: Vec<Effect>, status: &TrackingStatus, now: UtcMs) {
        // Outer Option: did the open segment change; inner: to what. Emitted once so a
        // focus change (close + open) does not flash an empty current segment.
        let mut current = None;
        let mut segments_changed = false;
        let mut status_changed = false;
        for effect in effects {
            match effect {
                Effect::OpenSegment { at, focus } => match self.sessions.open_segment(&focus, at) {
                    Ok(_) => {
                        current = Some(Some(focus));
                        segments_changed = true;
                    }
                    Err(e) => self.report(e),
                },
                Effect::CloseSegment { at, reason } => {
                    match self.sessions.close_open_segment(at, reason) {
                        Ok(()) => {
                            current = Some(None);
                            segments_changed = true;
                        }
                        Err(e) => self.report(e),
                    }
                }
                Effect::Heartbeat { at } => {
                    if let Err(e) = self.sessions.heartbeat(at) {
                        self.report(e);
                    }
                }
                Effect::CreateGap(gap) => self.create_gap(gap, now),
                Effect::StatusChanged => status_changed = true,
                Effect::PermissionChanged(state) => self.permission_changed(state),
            }
        }
        if let Some(focus) = current {
            self.sink.emit(DomainEvent::CurrentSegmentChanged(focus));
        }
        if segments_changed {
            self.sink.emit(DomainEvent::DataChanged(DataKind::Segments));
        }
        if status_changed {
            self.sink
                .emit(DomainEvent::TrackingStatusChanged(status.clone()));
        }
    }

    /// Expires pending gaps whose window elapsed (R3.4).
    pub fn expire_due(&mut self, now: UtcMs) {
        let (due, keep): (Vec<_>, Vec<_>) = std::mem::take(&mut self.pending)
            .into_iter()
            .partition(|g| g.is_due(now));
        self.pending = keep;
        for gap in due {
            self.expire(gap, now);
        }
    }

    pub fn resolve_gap(
        &mut self,
        id: GapId,
        resolution: IdleResolution,
        now: UtcMs,
    ) -> Result<(), ResolveError> {
        let index = self
            .pending
            .iter()
            .position(|g| g.id == Some(id))
            .ok_or(ResolveError::NotFound)?;
        if self.pending[index].is_due(now) {
            let gap = self.pending.remove(index);
            self.expire(gap, now);
            return Err(ResolveError::Expired);
        }
        let mut gap = self.pending.remove(index);
        let span = gap
            .resolve(resolution)
            .map_err(|_| ResolveError::NotFound)?;
        let saved = match &span {
            Some(span) => self.sessions.insert_assigned(span).map(|_| ()),
            None => Ok(()),
        }
        .and_then(|()| self.sessions.update_gap_status(id, gap.status, now));
        if let Err(e) = saved {
            // Keep the gap pending so the user can retry.
            gap.status = GapStatus::Pending;
            self.pending.insert(index, gap);
            return Err(ResolveError::Storage(e));
        }
        self.sink.emit(DomainEvent::IdleGapResolved {
            id,
            status: gap.status,
        });
        self.sink.emit(DomainEvent::DataChanged(DataKind::Gaps));
        if span.is_some() {
            self.sink.emit(DomainEvent::DataChanged(DataKind::Segments));
        }
        Ok(())
    }

    fn create_gap(&mut self, mut gap: IdleGap, now: UtcMs) {
        // A new gap supersedes any still-pending one ("al iniciarse otro gap").
        for old in std::mem::take(&mut self.pending) {
            self.expire(old, now);
        }
        if self.policy.auto_discards(gap.ended_at.0 - gap.started_at.0) {
            // Short break: store it as discarded, with no prompt, event or notification
            // beyond the data change for views that count them.
            gap.status = GapStatus::Resolved(IdleResolution::Discard);
            match self.sessions.insert_gap(&gap) {
                Ok(_) => self.sink.emit(DomainEvent::DataChanged(DataKind::Gaps)),
                Err(e) => self.report(e),
            }
            return;
        }
        // The domain stamps the default window; apply the configured one.
        gap.expires_at = gap
            .expires_at
            .plus_ms(self.policy.prompt_timeout_ms() - DEFAULT_IDLE_PROMPT_TIMEOUT_MS);
        match self.sessions.insert_gap(&gap) {
            Ok(id) => {
                gap.id = Some(id);
                self.pending.push(gap.clone());
                self.sink.emit(DomainEvent::IdleGapPending(gap.clone()));
                self.sink.emit(DomainEvent::DataChanged(DataKind::Gaps));
                self.notifier.idle_return(&gap);
            }
            Err(e) => self.report(e),
        }
    }

    fn expire(&mut self, mut gap: IdleGap, now: UtcMs) {
        gap.status = GapStatus::Expired;
        let Some(id) = gap.id else { return };
        match self.sessions.update_gap_status(id, GapStatus::Expired, now) {
            Ok(()) => {
                self.sink.emit(DomainEvent::IdleGapResolved {
                    id,
                    status: GapStatus::Expired,
                });
                self.sink.emit(DomainEvent::DataChanged(DataKind::Gaps));
            }
            Err(e) => self.report(e),
        }
    }

    fn permission_changed(&mut self, state: PermissionState) {
        self.sink.emit(DomainEvent::PermissionChanged(state));
        match state {
            // Notify once per revocation, not on every repeated Denied.
            PermissionState::Denied if !self.revocation_notified => {
                self.revocation_notified = true;
                self.notifier.permission_revoked();
            }
            PermissionState::Granted => self.revocation_notified = false,
            PermissionState::Denied => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::Ordering;

    use domain::{DEFAULT_IDLE_PROMPT_TIMEOUT_MS, EndReason, FocusSnapshot, SegmentSource};

    use super::*;
    use crate::fakes::{FakeStore, RecordingNotifier, RecordingSink};
    use crate::ports::TrackingKind;

    struct Rig {
        exec: EffectsExecutor,
        store: FakeStore,
        sink: RecordingSink,
        notifier: RecordingNotifier,
        policy: IdlePolicy,
    }

    fn rig() -> Rig {
        // Auto-discard off: the legacy tests use one second gaps and expect a prompt.
        rig_with_policy(IdlePolicy::new(600, 0))
    }

    fn rig_with_policy(policy: IdlePolicy) -> Rig {
        let (store, sink, notifier) = (
            FakeStore::default(),
            RecordingSink::default(),
            RecordingNotifier::default(),
        );
        let exec = EffectsExecutor::new(
            Box::new(store.clone()),
            Box::new(sink.clone()),
            Box::new(notifier.clone()),
            policy.clone(),
        );
        Rig {
            exec,
            store,
            sink,
            notifier,
            policy,
        }
    }

    fn focus(app: &str) -> FocusSnapshot {
        FocusSnapshot {
            app_id: format!("com.{app}"),
            app_name: app.into(),
            pid: 1,
            window_title: None,
        }
    }

    fn status() -> TrackingStatus {
        TrackingStatus {
            kind: TrackingKind::Running,
            current: None,
            since: None,
            degraded: false,
        }
    }

    fn gap(since: i64, end: i64) -> IdleGap {
        IdleGap::pending(UtcMs(since), UtcMs(end), Some(focus("a")), UtcMs(end))
    }

    fn open(app: &str, at: i64) -> Effect {
        Effect::OpenSegment {
            at: UtcMs(at),
            focus: focus(app),
        }
    }

    fn close(at: i64, reason: EndReason) -> Effect {
        Effect::CloseSegment {
            at: UtcMs(at),
            reason,
        }
    }

    #[test]
    fn focus_change_persists_both_edges_and_emits_one_current_change() {
        let mut r = rig();
        r.exec.execute(vec![open("a", 10)], &status(), UtcMs(10));
        r.sink.take();
        r.exec.execute(
            vec![close(20, EndReason::FocusChange), open("b", 20)],
            &status(),
            UtcMs(20),
        );
        let segs = r.store.segments();
        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0].end_reason, Some(EndReason::FocusChange));
        assert_eq!(segs[1].app_id.as_deref(), Some("com.b"));
        assert_eq!(
            r.sink.events(),
            vec![
                DomainEvent::CurrentSegmentChanged(Some(focus("b"))),
                DomainEvent::DataChanged(DataKind::Segments),
            ]
        );
    }

    #[test]
    fn close_without_open_clears_current_and_status_event_carries_status() {
        let mut r = rig();
        r.exec.execute(vec![open("a", 10)], &status(), UtcMs(10));
        r.sink.take();
        r.exec.execute(
            vec![close(30, EndReason::Pause), Effect::StatusChanged],
            &status(),
            UtcMs(30),
        );
        assert_eq!(
            r.sink.events(),
            vec![
                DomainEvent::CurrentSegmentChanged(None),
                DomainEvent::DataChanged(DataKind::Segments),
                DomainEvent::TrackingStatusChanged(status()),
            ]
        );
    }

    #[test]
    fn storage_failure_is_reported_and_does_not_panic() {
        let mut r = rig();
        r.store.fail_next(1);
        r.exec.execute(vec![open("a", 10)], &status(), UtcMs(10));
        assert!(r.store.segments().is_empty());
        assert_eq!(
            r.sink.events(),
            vec![DomainEvent::StorageFailed("injected failure".into())]
        );
    }

    #[test]
    fn creating_a_gap_persists_announces_and_notifies() {
        let mut r = rig();
        r.exec.execute(
            vec![Effect::CreateGap(gap(0, 1_000))],
            &status(),
            UtcMs(1_000),
        );
        assert_eq!(r.store.gaps().len(), 1);
        assert_eq!(r.exec.pending_gaps()[0].id, Some(GapId(1)));
        assert_eq!(r.notifier.idle_returns.load(Ordering::SeqCst), 1);
        assert!(matches!(r.sink.events()[0], DomainEvent::IdleGapPending(_)));
    }

    #[test]
    fn a_new_gap_expires_the_previous_pending_one() {
        let mut r = rig();
        r.exec.execute(
            vec![Effect::CreateGap(gap(0, 1_000))],
            &status(),
            UtcMs(1_000),
        );
        r.exec.execute(
            vec![Effect::CreateGap(gap(2_000, 3_000))],
            &status(),
            UtcMs(3_000),
        );
        let gaps = r.store.gaps();
        assert_eq!(gaps[0].status, GapStatus::Expired);
        assert_eq!(gaps[1].status, GapStatus::Pending);
        assert_eq!(r.exec.pending_gaps().len(), 1);
        assert_eq!(r.exec.pending_gaps()[0].id, Some(GapId(2)));
    }

    #[test]
    fn gap_expires_exactly_at_ten_minutes() {
        let mut r = rig();
        r.exec.execute(
            vec![Effect::CreateGap(gap(0, 1_000))],
            &status(),
            UtcMs(1_000),
        );
        r.exec
            .expire_due(UtcMs(1_000 + DEFAULT_IDLE_PROMPT_TIMEOUT_MS - 1));
        assert_eq!(r.exec.pending_gaps().len(), 1);
        r.exec
            .expire_due(UtcMs(1_000 + DEFAULT_IDLE_PROMPT_TIMEOUT_MS));
        assert!(r.exec.pending_gaps().is_empty());
        assert_eq!(r.store.gaps()[0].status, GapStatus::Expired);
    }

    #[test]
    fn short_gap_is_stored_discarded_without_prompt_or_notification() {
        let mut r = rig_with_policy(IdlePolicy::new(600, 120));
        r.exec.execute(
            vec![Effect::CreateGap(gap(0, 60_000))],
            &status(),
            UtcMs(60_000),
        );
        assert!(r.exec.pending_gaps().is_empty());
        assert_eq!(
            r.store.gaps()[0].status,
            GapStatus::Resolved(IdleResolution::Discard)
        );
        assert_eq!(r.notifier.idle_returns.load(Ordering::SeqCst), 0);
        let events = r.sink.events();
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, DomainEvent::IdleGapPending(_)))
        );
    }

    #[test]
    fn long_gap_still_prompts_with_the_policy() {
        let mut r = rig_with_policy(IdlePolicy::new(600, 120));
        r.exec.execute(
            vec![Effect::CreateGap(gap(0, 600_000))],
            &status(),
            UtcMs(600_000),
        );
        assert_eq!(r.exec.pending_gaps().len(), 1);
        assert_eq!(r.notifier.idle_returns.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn changed_timeout_and_threshold_apply_to_the_next_gap_without_restart() {
        let mut r = rig_with_policy(IdlePolicy::new(600, 120));
        r.policy.set(30, 0);
        r.exec.execute(
            vec![Effect::CreateGap(gap(0, 1_000))],
            &status(),
            UtcMs(1_000),
        );
        // 1 s gap prompts now (auto-discard off) and expires after 30 s.
        assert_eq!(r.exec.pending_gaps().len(), 1);
        r.exec.expire_due(UtcMs(1_000 + 29_999));
        assert_eq!(r.exec.pending_gaps().len(), 1);
        r.exec.expire_due(UtcMs(1_000 + 30_000));
        assert!(r.exec.pending_gaps().is_empty());
    }

    #[test]
    fn assign_previous_inserts_an_idle_assigned_segment() {
        let mut r = rig();
        r.exec.execute(
            vec![Effect::CreateGap(gap(100, 900))],
            &status(),
            UtcMs(900),
        );
        r.exec
            .resolve_gap(GapId(1), IdleResolution::AssignPrevious, UtcMs(1_000))
            .unwrap();
        let seg = &r.store.segments()[0];
        assert_eq!(seg.source, SegmentSource::IdleAssigned);
        assert_eq!(seg.app_id.as_deref(), Some("com.a"));
        assert_eq!(
            (seg.started_at, seg.ended_at),
            (UtcMs(100), Some(UtcMs(900)))
        );
        assert!(r.exec.pending_gaps().is_empty());
        assert!(matches!(r.store.gaps()[0].status, GapStatus::Resolved(_)));
    }

    #[test]
    fn discard_persists_no_segment() {
        let mut r = rig();
        r.exec.execute(
            vec![Effect::CreateGap(gap(100, 900))],
            &status(),
            UtcMs(900),
        );
        r.exec
            .resolve_gap(GapId(1), IdleResolution::Discard, UtcMs(1_000))
            .unwrap();
        assert!(r.store.segments().is_empty());
    }

    #[test]
    fn resolving_after_the_window_or_twice_is_rejected() {
        let mut r = rig();
        r.exec.execute(
            vec![Effect::CreateGap(gap(0, 1_000))],
            &status(),
            UtcMs(1_000),
        );
        let late = UtcMs(1_000 + DEFAULT_IDLE_PROMPT_TIMEOUT_MS);
        assert_eq!(
            r.exec
                .resolve_gap(GapId(1), IdleResolution::AssignPrevious, late),
            Err(ResolveError::Expired)
        );
        assert!(r.store.segments().is_empty());
        assert_eq!(r.store.gaps()[0].status, GapStatus::Expired);
        assert_eq!(
            r.exec.resolve_gap(GapId(1), IdleResolution::Discard, late),
            Err(ResolveError::NotFound)
        );
    }

    #[test]
    fn failed_resolution_keeps_the_gap_pending_for_retry() {
        let mut r = rig();
        r.exec.execute(
            vec![Effect::CreateGap(gap(0, 1_000))],
            &status(),
            UtcMs(1_000),
        );
        r.store.fail_next(1);
        assert!(matches!(
            r.exec
                .resolve_gap(GapId(1), IdleResolution::AssignPrevious, UtcMs(2_000)),
            Err(ResolveError::Storage(_))
        ));
        assert_eq!(r.exec.pending_gaps().len(), 1);
        r.exec
            .resolve_gap(GapId(1), IdleResolution::AssignPrevious, UtcMs(2_000))
            .unwrap();
        assert_eq!(r.store.segments().len(), 1);
    }

    #[test]
    fn revocation_is_notified_once_until_granted_again() {
        let mut r = rig();
        let denied = || vec![Effect::PermissionChanged(PermissionState::Denied)];
        r.exec.execute(denied(), &status(), UtcMs(1));
        r.exec.execute(denied(), &status(), UtcMs(2));
        assert_eq!(r.notifier.revocations.load(Ordering::SeqCst), 1);
        r.exec.execute(
            vec![Effect::PermissionChanged(PermissionState::Granted)],
            &status(),
            UtcMs(3),
        );
        r.exec.execute(denied(), &status(), UtcMs(4));
        assert_eq!(r.notifier.revocations.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn recover_closes_orphans_and_expires_pending_gaps() {
        let mut r = rig();
        r.store.seed_segment(domain::Segment {
            id: domain::SegmentId(0),
            started_at: UtcMs(10),
            ended_at: None,
            heartbeat_at: UtcMs(50),
            app_id: Some("com.a".into()),
            app_name: Some("A".into()),
            window_title: None,
            end_reason: None,
            source: SegmentSource::Tracked,
            activity_id: None,
        });
        r.store.seed_gap(gap(0, 5));
        r.exec.recover(UtcMs(1_000));
        let seg = &r.store.segments()[0];
        assert_eq!(
            (seg.ended_at, seg.end_reason),
            (Some(UtcMs(50)), Some(EndReason::Recovered))
        );
        assert_eq!(r.store.gaps()[0].status, GapStatus::Expired);
        assert!(r.exec.pending_gaps().is_empty());
    }
}
