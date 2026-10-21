//! Pure derived figures for the Overview: trend against the previous period and the focus
//! ratio. Both make the "nothing to compare" case explicit instead of dividing by zero.

/// Change of a period against the one before it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trend {
    /// The previous period has no tracked time, so there is nothing to compare with.
    NoComparison,
    Change {
        /// `current - previous` in milliseconds (negative when the time went down).
        delta_ms: i64,
        /// Relative change in whole percent, rounded half away from zero.
        pct: i32,
    },
}

/// Compares `current_ms` with `previous_ms`; a previous period without time (or a negative
/// value, which cannot happen for real data) gives [`Trend::NoComparison`].
pub fn trend(current_ms: i64, previous_ms: i64) -> Trend {
    if previous_ms <= 0 {
        return Trend::NoComparison;
    }
    let delta_ms = current_ms.saturating_sub(previous_ms);
    let pct = (delta_ms as f64 / previous_ms as f64 * 100.0).round();
    Trend::Change {
        delta_ms,
        pct: pct.clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32,
    }
}

/// Share of productive time among productive plus distracting time.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FocusRatio {
    /// No productive and no distracting time (everything is neutral or nothing was tracked).
    NoSignal,
    /// `productive / (productive + distracting)`, between 0 and 1.
    Ratio(f64),
}

pub fn focus_ratio(productive_ms: i64, distracting_ms: i64) -> FocusRatio {
    let productive = productive_ms.max(0);
    let distracting = distracting_ms.max(0);
    let signal = productive + distracting;
    if signal == 0 {
        FocusRatio::NoSignal
    } else {
        FocusRatio::Ratio(productive as f64 / signal as f64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_previous_period_is_not_a_division_by_zero() {
        assert_eq!(trend(5_000, 0), Trend::NoComparison);
        assert_eq!(trend(0, 0), Trend::NoComparison);
    }

    #[test]
    fn trend_reports_delta_and_rounded_percent() {
        assert_eq!(
            trend(150, 100),
            Trend::Change {
                delta_ms: 50,
                pct: 50
            }
        );
        assert_eq!(
            trend(50, 100),
            Trend::Change {
                delta_ms: -50,
                pct: -50
            }
        );
        assert_eq!(
            trend(100, 100),
            Trend::Change {
                delta_ms: 0,
                pct: 0
            }
        );
        // 1/3 rounds to 33, 2/3 to 67.
        assert_eq!(
            trend(133, 100),
            Trend::Change {
                delta_ms: 33,
                pct: 33
            }
        );
        // Dropping to nothing is a -100 % change, not "no comparison".
        assert_eq!(
            trend(0, 100),
            Trend::Change {
                delta_ms: -100,
                pct: -100
            }
        );
    }

    #[test]
    fn only_neutral_time_gives_no_signal() {
        assert_eq!(focus_ratio(0, 0), FocusRatio::NoSignal);
    }

    #[test]
    fn ratio_is_productive_over_productive_plus_distracting() {
        assert_eq!(focus_ratio(30, 10), FocusRatio::Ratio(0.75));
        assert_eq!(focus_ratio(0, 10), FocusRatio::Ratio(0.0));
        assert_eq!(focus_ratio(10, 0), FocusRatio::Ratio(1.0));
    }
}
