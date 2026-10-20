//! In-memory fakes for every port. Cloning a fake shares its state, so a test keeps one
//! clone to inspect while the engine owns the other.

use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use crossbeam_channel::Sender;
use domain::{
    AssignedSpan, Category, CategoryId, CategoryRule, EndReason, FocusSnapshot, GapId, GapStatus,
    IdleGap, PermissionState, PrivacyPolicy, Segment, SegmentId, SegmentSource, UtcMs,
};

use crate::ports::*;

#[derive(Clone, Default)]
pub struct FakeClock(Arc<AtomicI64>);

impl FakeClock {
    pub fn at(ms: i64) -> Self {
        Self(Arc::new(AtomicI64::new(ms)))
    }
    pub fn set(&self, ms: i64) {
        self.0.store(ms, Ordering::SeqCst);
    }
    pub fn advance(&self, ms: i64) {
        self.0.fetch_add(ms, Ordering::SeqCst);
    }
}

impl Clock for FakeClock {
    fn now(&self) -> UtcMs {
        UtcMs(self.0.load(Ordering::SeqCst))
    }
}

#[derive(Clone, Default)]
pub struct FakeWindow(Arc<Mutex<Option<FocusSnapshot>>>);

impl FakeWindow {
    pub fn set(&self, focus: Option<FocusSnapshot>) {
        *self.0.lock().unwrap() = focus;
    }
}

impl ActiveWindowProvider for FakeWindow {
    fn current(&self) -> Option<FocusSnapshot> {
        self.0.lock().unwrap().clone()
    }
}

#[derive(Clone, Default)]
pub struct FakeIdle(Arc<Mutex<f64>>);

impl FakeIdle {
    pub fn set(&self, seconds: f64) {
        *self.0.lock().unwrap() = seconds;
    }
}

impl IdleProvider for FakeIdle {
    fn seconds_since_input(&self) -> f64 {
        *self.0.lock().unwrap()
    }
}

#[derive(Clone, Default)]
pub struct FakePower(Arc<Mutex<Vec<Sender<SystemSignal>>>>);

impl FakePower {
    /// Delivers a signal to every subscriber, as the OS observer would.
    pub fn emit(&self, signal: SystemSignal) {
        for tx in self.0.lock().unwrap().iter() {
            let _ = tx.send(signal.clone());
        }
    }
}

impl PowerEventsProvider for FakePower {
    fn subscribe(&self, tx: Sender<SystemSignal>) {
        self.0.lock().unwrap().push(tx);
    }
}

#[derive(Clone)]
pub struct FakePermission {
    state: Arc<Mutex<PermissionState>>,
    pub requests: Arc<AtomicUsize>,
    pub settings_opened: Arc<AtomicUsize>,
}

impl FakePermission {
    pub fn new(state: PermissionState) -> Self {
        Self {
            state: Arc::new(Mutex::new(state)),
            requests: Arc::default(),
            settings_opened: Arc::default(),
        }
    }
    pub fn set(&self, state: PermissionState) {
        *self.state.lock().unwrap() = state;
    }
}

impl PermissionProvider for FakePermission {
    fn accessibility(&self) -> PermissionState {
        *self.state.lock().unwrap()
    }
    fn request(&self) {
        self.requests.fetch_add(1, Ordering::SeqCst);
    }
    fn open_settings(&self) {
        self.settings_opened.fetch_add(1, Ordering::SeqCst);
    }
}

#[derive(Default)]
struct Store {
    segments: Vec<Segment>,
    gaps: Vec<IdleGap>,
    next_segment: i64,
    next_gap: i64,
    /// Number of calls that should fail, to exercise error paths.
    fail_next: usize,
}

/// Implements both `SessionRepository` and `ReportRepository` over one shared store.
/// Like the SQL unique index, it refuses a second open segment.
#[derive(Clone, Default)]
pub struct FakeStore(Arc<Mutex<Store>>);

impl FakeStore {
    pub fn segments(&self) -> Vec<Segment> {
        self.0.lock().unwrap().segments.clone()
    }
    pub fn gaps(&self) -> Vec<IdleGap> {
        self.0.lock().unwrap().gaps.clone()
    }
    pub fn seed_segment(&self, mut segment: Segment) {
        let mut s = self.0.lock().unwrap();
        s.next_segment += 1;
        segment.id = SegmentId(s.next_segment);
        s.segments.push(segment);
    }
    pub fn seed_gap(&self, mut gap: IdleGap) -> GapId {
        let mut s = self.0.lock().unwrap();
        s.next_gap += 1;
        gap.id = Some(GapId(s.next_gap));
        s.gaps.push(gap);
        GapId(s.next_gap)
    }
    /// Makes the next `n` write calls fail.
    pub fn fail_next(&self, n: usize) {
        self.0.lock().unwrap().fail_next = n;
    }

    fn guard(&self) -> PortResult<std::sync::MutexGuard<'_, Store>> {
        let mut s = self.0.lock().unwrap();
        if s.fail_next > 0 {
            s.fail_next -= 1;
            return Err(PortError("injected failure".into()));
        }
        Ok(s)
    }
}

impl SessionRepository for FakeStore {
    fn open_segment(&mut self, focus: &FocusSnapshot, at: UtcMs) -> PortResult<SegmentId> {
        let mut s = self.guard()?;
        if s.segments.iter().any(|g| g.ended_at.is_none()) {
            return Err(PortError("a segment is already open".into()));
        }
        s.next_segment += 1;
        let id = SegmentId(s.next_segment);
        s.segments.push(Segment {
            id,
            started_at: at,
            ended_at: None,
            heartbeat_at: at,
            app_id: Some(focus.app_id.clone()),
            app_name: Some(focus.app_name.clone()),
            window_title: focus.window_title.clone(),
            end_reason: None,
            source: SegmentSource::Tracked,
            category_id: None,
        });
        Ok(id)
    }

    fn close_open_segment(&mut self, at: UtcMs, reason: EndReason) -> PortResult<()> {
        let mut s = self.guard()?;
        if let Some(open) = s.segments.iter_mut().find(|g| g.ended_at.is_none()) {
            open.ended_at = Some(at);
            open.heartbeat_at = at;
            open.end_reason = Some(reason);
        }
        Ok(())
    }

    fn heartbeat(&mut self, at: UtcMs) -> PortResult<()> {
        let mut s = self.guard()?;
        if let Some(open) = s.segments.iter_mut().find(|g| g.ended_at.is_none()) {
            open.heartbeat_at = at;
        }
        Ok(())
    }

    fn insert_assigned(&mut self, span: &AssignedSpan) -> PortResult<SegmentId> {
        let mut s = self.guard()?;
        s.next_segment += 1;
        let id = SegmentId(s.next_segment);
        s.segments.push(Segment {
            id,
            started_at: span.started_at,
            ended_at: Some(span.ended_at),
            heartbeat_at: span.ended_at,
            app_id: span.app_id.clone(),
            app_name: span.app_name.clone(),
            window_title: span.window_title.clone(),
            end_reason: Some(EndReason::Idle),
            source: SegmentSource::IdleAssigned,
            category_id: span.category_id,
        });
        Ok(id)
    }

    fn insert_gap(&mut self, gap: &IdleGap) -> PortResult<GapId> {
        let mut s = self.guard()?;
        s.next_gap += 1;
        let id = GapId(s.next_gap);
        s.gaps.push(IdleGap {
            id: Some(id),
            ..gap.clone()
        });
        Ok(id)
    }

    fn update_gap_status(&mut self, id: GapId, status: GapStatus, _at: UtcMs) -> PortResult<()> {
        let mut s = self.guard()?;
        match s.gaps.iter_mut().find(|g| g.id == Some(id)) {
            Some(gap) => {
                gap.status = status;
                Ok(())
            }
            None => Err(PortError("unknown gap".into())),
        }
    }

    fn pending_gaps(&mut self) -> PortResult<Vec<IdleGap>> {
        let s = self.guard()?;
        Ok(s.gaps
            .iter()
            .filter(|g| g.status == GapStatus::Pending)
            .cloned()
            .collect())
    }

    fn recover_orphans(&mut self) -> PortResult<usize> {
        let mut s = self.guard()?;
        let mut n = 0;
        for seg in s.segments.iter_mut().filter(|g| g.ended_at.is_none()) {
            seg.ended_at = Some(seg.heartbeat_at);
            seg.end_reason = Some(EndReason::Recovered);
            n += 1;
        }
        Ok(n)
    }
}

impl ReportRepository for FakeStore {
    fn segments_in_range(&self, from: UtcMs, to: UtcMs) -> PortResult<Vec<Segment>> {
        let s = self.0.lock().unwrap();
        Ok(s.segments
            .iter()
            .filter(|g| g.started_at < to && g.ended_at.is_none_or(|e| e > from))
            .cloned()
            .collect())
    }
}

#[derive(Clone, Default)]
pub struct FakeSettings(Arc<Mutex<HashMap<String, String>>>);

impl SettingsRepository for FakeSettings {
    fn get(&self, key: &str) -> PortResult<Option<String>> {
        Ok(self.0.lock().unwrap().get(key).cloned())
    }
    fn set(&self, key: &str, value: &str) -> PortResult<()> {
        self.0.lock().unwrap().insert(key.into(), value.into());
        Ok(())
    }
}

#[derive(Default)]
struct Categories {
    categories: Vec<Category>,
    rules: Vec<CategoryRule>,
    next_id: i64,
}

#[derive(Clone, Default)]
pub struct FakeCategories(Arc<Mutex<Categories>>);

impl CategoryRepository for FakeCategories {
    fn list(&self) -> PortResult<Vec<Category>> {
        Ok(self.0.lock().unwrap().categories.clone())
    }
    fn create(&self, name: &str, color: &str) -> PortResult<Category> {
        let mut s = self.0.lock().unwrap();
        s.next_id += 1;
        let category = Category {
            id: CategoryId(s.next_id),
            name: name.into(),
            color: color.into(),
            sort_order: 0,
        };
        s.categories.push(category.clone());
        Ok(category)
    }
    fn update(&self, category: &Category) -> PortResult<()> {
        let mut s = self.0.lock().unwrap();
        match s.categories.iter_mut().find(|c| c.id == category.id) {
            Some(c) => {
                *c = category.clone();
                Ok(())
            }
            None => Err(PortError("unknown category".into())),
        }
    }
    fn delete(&self, id: CategoryId) -> PortResult<()> {
        let mut s = self.0.lock().unwrap();
        s.categories.retain(|c| c.id != id);
        s.rules.retain(|r| r.category_id != id);
        Ok(())
    }
    fn list_rules(&self) -> PortResult<Vec<CategoryRule>> {
        Ok(self.0.lock().unwrap().rules.clone())
    }
    fn save_rule(&self, rule: &CategoryRule) -> PortResult<i64> {
        let mut s = self.0.lock().unwrap();
        s.rules.retain(|r| r.id != rule.id);
        s.rules.push(rule.clone());
        Ok(rule.id)
    }
    fn delete_rule(&self, id: i64) -> PortResult<()> {
        self.0.lock().unwrap().rules.retain(|r| r.id != id);
        Ok(())
    }
}

#[derive(Clone, Default)]
pub struct FakePrivacy(Arc<Mutex<PrivacyPolicy>>);

impl FakePrivacy {
    pub fn set_store_titles(&self, on: bool) {
        self.0.lock().unwrap().store_titles = on;
    }
}

impl PrivacyRepository for FakePrivacy {
    fn load_policy(&self) -> PortResult<PrivacyPolicy> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn set_mode(&self, app_id: &str, mode: Option<PrivacyMode>) -> PortResult<()> {
        let mut p = self.0.lock().unwrap();
        p.excluded_apps.remove(app_id);
        p.redacted_apps.remove(app_id);
        match mode {
            Some(PrivacyMode::Exclude) => p.excluded_apps.insert(app_id.into()),
            Some(PrivacyMode::RedactTitle) => p.redacted_apps.insert(app_id.into()),
            None => false,
        };
        Ok(())
    }
}

#[derive(Clone, Default)]
pub struct RecordingSink(Arc<Mutex<Vec<DomainEvent>>>);

impl RecordingSink {
    pub fn events(&self) -> Vec<DomainEvent> {
        self.0.lock().unwrap().clone()
    }
    pub fn take(&self) -> Vec<DomainEvent> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
}

impl EventSink for RecordingSink {
    fn emit(&self, event: DomainEvent) {
        self.0.lock().unwrap().push(event);
    }
}

#[derive(Clone, Default)]
pub struct RecordingNotifier {
    pub idle_returns: Arc<AtomicUsize>,
    pub revocations: Arc<AtomicUsize>,
}

impl Notifier for RecordingNotifier {
    fn idle_return(&self, _gap: &IdleGap) {
        self.idle_returns.fetch_add(1, Ordering::SeqCst);
    }
    fn permission_revoked(&self) {
        self.revocations.fetch_add(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn focus() -> FocusSnapshot {
        FocusSnapshot {
            app_id: "com.a".into(),
            app_name: "A".into(),
            pid: 1,
            window_title: None,
        }
    }

    #[test]
    fn store_refuses_a_second_open_segment_like_the_unique_index() {
        let mut store = FakeStore::default();
        store.open_segment(&focus(), UtcMs(1)).unwrap();
        assert!(store.open_segment(&focus(), UtcMs(2)).is_err());
        store.close_open_segment(UtcMs(3), EndReason::Stop).unwrap();
        store.open_segment(&focus(), UtcMs(4)).unwrap();
    }

    #[test]
    fn recover_orphans_closes_at_heartbeat() {
        let mut store = FakeStore::default();
        store.open_segment(&focus(), UtcMs(1)).unwrap();
        store.heartbeat(UtcMs(9)).unwrap();
        assert_eq!(store.recover_orphans(), Ok(1));
        let seg = &store.segments()[0];
        assert_eq!(seg.ended_at, Some(UtcMs(9)));
        assert_eq!(seg.end_reason, Some(EndReason::Recovered));
    }

    #[test]
    fn privacy_modes_are_exclusive_per_app() {
        let privacy = FakePrivacy::default();
        privacy.set_mode("x", Some(PrivacyMode::Exclude)).unwrap();
        privacy
            .set_mode("x", Some(PrivacyMode::RedactTitle))
            .unwrap();
        let p = privacy.load_policy().unwrap();
        assert!(!p.excluded_apps.contains("x") && p.redacted_apps.contains("x"));
    }
}
