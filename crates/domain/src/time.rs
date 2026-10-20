/// Milliseconds since the Unix epoch (UTC); the only persisted time unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct UtcMs(pub i64);

impl UtcMs {
    /// Signed distance `self - earlier` in milliseconds (R1.2: clock difference, never ticks).
    pub fn since(self, earlier: UtcMs) -> i64 {
        self.0.saturating_sub(earlier.0)
    }

    pub fn plus_ms(self, ms: i64) -> UtcMs {
        UtcMs(self.0.saturating_add(ms))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn since_is_clock_difference() {
        assert_eq!(UtcMs(91_000).since(UtcMs(1_000)), 90_000);
        assert_eq!(UtcMs(1).since(UtcMs(5)), -4);
    }

    #[test]
    fn arithmetic_saturates() {
        assert_eq!(UtcMs(i64::MAX).plus_ms(1), UtcMs(i64::MAX));
        assert_eq!(UtcMs(i64::MIN).since(UtcMs(1)), i64::MIN);
    }
}
