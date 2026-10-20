//! Idle detection (design sections 6 and 11, task 2.5). The OS only reports "seconds since
//! the last input event"; [`IdleTracker`] turns that into `IdleDetected` / `ActivityResumed`
//! signals against the configured threshold.

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use application::ports::SystemSignal;
use domain::UtcMs;

/// Idle threshold in seconds, shared between settings (writer) and the sampler (reader).
#[derive(Debug, Clone)]
pub struct IdleThreshold(Arc<AtomicU32>);

impl IdleThreshold {
    pub const DEFAULT_SECS: u32 = 300;

    pub fn new(secs: u32) -> Self {
        Self(Arc::new(AtomicU32::new(secs.max(1))))
    }

    pub fn get(&self) -> u32 {
        self.0.load(Ordering::Relaxed)
    }

    pub fn set(&self, secs: u32) {
        self.0.store(secs.max(1), Ordering::Relaxed);
    }
}

impl Default for IdleThreshold {
    fn default() -> Self {
        Self::new(Self::DEFAULT_SECS)
    }
}

/// Edge detector over the "seconds since last input" reading.
#[derive(Debug)]
pub struct IdleTracker {
    threshold: IdleThreshold,
    idle: bool,
}

impl IdleTracker {
    pub fn new(threshold: IdleThreshold) -> Self {
        Self {
            threshold,
            idle: false,
        }
    }

    /// `IdleDetected{since = now - seconds}` on the way in (R3.2: the idle time is cut
    /// retroactively at the last input) and `ActivityResumed` on the way out; `None` otherwise.
    pub fn observe(&mut self, seconds_since_input: f64, now: UtcMs) -> Option<SystemSignal> {
        let seconds = if seconds_since_input.is_finite() {
            seconds_since_input.max(0.0)
        } else {
            0.0
        };
        let beyond = seconds >= f64::from(self.threshold.get());
        match (self.idle, beyond) {
            (false, true) => {
                self.idle = true;
                // Truncation is fine: millisecond precision, bounded by the OS counter.
                #[allow(clippy::cast_possible_truncation)]
                let since = UtcMs(now.0.saturating_sub((seconds * 1000.0) as i64));
                Some(SystemSignal::IdleDetected { since })
            }
            (true, false) => {
                self.idle = false;
                Some(SystemSignal::ActivityResumed)
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tracker(threshold: u32) -> IdleTracker {
        IdleTracker::new(IdleThreshold::new(threshold))
    }

    #[test]
    fn crossing_the_threshold_reports_idle_since_the_last_input() {
        let mut t = tracker(300);
        assert_eq!(t.observe(120.0, UtcMs(1_000_000)), None);
        assert_eq!(
            t.observe(301.5, UtcMs(1_000_000)),
            Some(SystemSignal::IdleDetected {
                since: UtcMs(1_000_000 - 301_500)
            })
        );
    }

    #[test]
    fn idle_is_reported_once_and_input_resumes_it_once() {
        let mut t = tracker(60);
        assert!(t.observe(61.0, UtcMs(100_000)).is_some());
        assert_eq!(t.observe(63.0, UtcMs(102_000)), None);
        assert_eq!(
            t.observe(0.4, UtcMs(103_000)),
            Some(SystemSignal::ActivityResumed)
        );
        assert_eq!(t.observe(1.0, UtcMs(104_000)), None);
    }

    #[test]
    fn the_threshold_is_read_live() {
        let threshold = IdleThreshold::new(300);
        let mut t = IdleTracker::new(threshold.clone());
        assert_eq!(t.observe(100.0, UtcMs(0)), None);
        threshold.set(60);
        assert!(matches!(
            t.observe(100.0, UtcMs(0)),
            Some(SystemSignal::IdleDetected { .. })
        ));
    }

    #[test]
    fn garbage_readings_are_treated_as_activity() {
        let mut t = tracker(60);
        assert_eq!(t.observe(f64::NAN, UtcMs(0)), None);
        assert_eq!(t.observe(-5.0, UtcMs(0)), None);
        assert_eq!(t.observe(f64::INFINITY, UtcMs(0)), None);
    }

    #[test]
    fn a_zero_threshold_is_clamped_to_one_second() {
        assert_eq!(IdleThreshold::new(0).get(), 1);
    }
}
