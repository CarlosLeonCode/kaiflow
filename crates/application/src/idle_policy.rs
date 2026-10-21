//! Live idle-prompt policy shared between settings (writer) and the effects executor (reader).
//!
//! Same pattern as the sampler's idle threshold: two atomics behind an `Arc`, so a settings
//! change applies to the next gap without restarting the engine.

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

/// Default time the user has to answer the idle prompt.
pub const DEFAULT_PROMPT_TIMEOUT_SECS: u32 = 600;
/// Default length below which a gap is discarded without asking (0 = always ask).
pub const DEFAULT_AUTO_DISCARD_BELOW_SECS: u32 = 120;

#[derive(Debug, Clone)]
pub struct IdlePolicy {
    prompt_timeout_secs: Arc<AtomicU32>,
    auto_discard_below_secs: Arc<AtomicU32>,
}

impl IdlePolicy {
    pub fn new(prompt_timeout_secs: u32, auto_discard_below_secs: u32) -> Self {
        Self {
            prompt_timeout_secs: Arc::new(AtomicU32::new(prompt_timeout_secs.max(1))),
            auto_discard_below_secs: Arc::new(AtomicU32::new(auto_discard_below_secs)),
        }
    }

    pub fn prompt_timeout_secs(&self) -> u32 {
        self.prompt_timeout_secs.load(Ordering::Relaxed)
    }

    pub fn auto_discard_below_secs(&self) -> u32 {
        self.auto_discard_below_secs.load(Ordering::Relaxed)
    }

    pub fn set(&self, prompt_timeout_secs: u32, auto_discard_below_secs: u32) {
        self.prompt_timeout_secs
            .store(prompt_timeout_secs.max(1), Ordering::Relaxed);
        self.auto_discard_below_secs
            .store(auto_discard_below_secs, Ordering::Relaxed);
    }

    /// Whether a gap of `duration_ms` is stored as discarded without prompting.
    pub fn auto_discards(&self, duration_ms: i64) -> bool {
        let below = i64::from(self.auto_discard_below_secs());
        below > 0 && duration_ms < below * 1_000
    }

    pub fn prompt_timeout_ms(&self) -> i64 {
        i64::from(self.prompt_timeout_secs()) * 1_000
    }
}

impl Default for IdlePolicy {
    fn default() -> Self {
        Self::new(DEFAULT_PROMPT_TIMEOUT_SECS, DEFAULT_AUTO_DISCARD_BELOW_SECS)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_disables_auto_discard_and_threshold_is_exclusive() {
        let p = IdlePolicy::new(600, 120);
        assert!(p.auto_discards(119_999));
        assert!(!p.auto_discards(120_000));
        p.set(600, 0);
        assert!(!p.auto_discards(1));
    }

    #[test]
    fn clones_observe_updates() {
        let p = IdlePolicy::default();
        let reader = p.clone();
        p.set(30, 60);
        assert_eq!(reader.prompt_timeout_ms(), 30_000);
        assert_eq!(reader.auto_discard_below_secs(), 60);
    }
}
