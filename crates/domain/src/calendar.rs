//! Local-calendar facts the domain needs without owning a clock or a time zone.

/// The local hour a UTC instant falls in, as reported by a `Calendar` adapter.
///
/// `next_boundary` is the first instant of the following local hour, so a span can be cut hour
/// by hour without assuming that hours are 60 minutes long (DST transitions, half-hour zones).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HourSlot {
    /// Local weekday, 0 = Monday .. 6 = Sunday.
    pub weekday: u8,
    /// Local hour of the day, 0..=23.
    pub hour: u8,
    pub next_boundary: crate::UtcMs,
}

/// Length of a goal period.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Period {
    Daily,
    Weekly,
    Monthly,
}

impl Period {
    pub const ALL: [Self; 3] = [Self::Daily, Self::Weekly, Self::Monthly];

    /// Stable name used in storage and on the wire.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Weekly => "weekly",
            Self::Monthly => "monthly",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.as_str() == name)
    }
}

/// Weekday of a local day number (days since 1970-01-01): 0 = Monday .. 6 = Sunday.
pub fn weekday_of(day: i64) -> u8 {
    // 1970-01-01 was a Thursday.
    (day + 3).rem_euclid(7) as u8
}

/// Whether bit `weekday` (0 = Monday) of `mask` is set. Bit 0 is Monday, bit 6 Sunday.
pub fn mask_has(mask: u8, weekday: u8) -> bool {
    weekday < 7 && mask & (1 << weekday) != 0
}

/// Mask with every day of the week selected.
pub const ALL_DAYS: u8 = 0b111_1111;

/// First local day of the period containing `day`. `week_start` is 0 (Monday) to 6 (Sunday);
/// larger values count as Monday.
pub fn period_start(period: Period, day: i64, week_start: u8) -> i64 {
    match period {
        Period::Daily => day,
        Period::Weekly => {
            let start = i64::from(if week_start < 7 { week_start } else { 0 });
            day - (i64::from(weekday_of(day)) - start).rem_euclid(7)
        }
        Period::Monthly => {
            let (year, month, _) = crate::backup_retention::civil_from_days(day);
            crate::backup_retention::days_from_civil(year, month, 1).unwrap_or(day)
        }
    }
}

/// First local day of the period that follows the one starting at `start`.
pub fn next_period_start(period: Period, start: i64) -> i64 {
    match period {
        Period::Daily => start + 1,
        Period::Weekly => start + 7,
        Period::Monthly => {
            let (year, month, _) = crate::backup_retention::civil_from_days(start);
            let (year, month) = if month == 12 {
                (year + 1, 1)
            } else {
                (year, month + 1)
            };
            crate::backup_retention::days_from_civil(year, month, 1).unwrap_or(start + 31)
        }
    }
}

/// `[first, end)` local days of the period containing `day`.
pub fn period_dates(period: Period, day: i64, week_start: u8) -> (i64, i64) {
    let first = period_start(period, day, week_start);
    (first, next_period_start(period, first))
}

/// First local day of the period before the one starting at `start`.
pub fn previous_period_start(period: Period, start: i64, week_start: u8) -> i64 {
    period_start(period, start - 1, week_start)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup_retention::days_from_civil;

    fn day(y: i64, m: u32, d: u32) -> i64 {
        days_from_civil(y, m, d).unwrap()
    }

    #[test]
    fn weekdays_count_from_monday() {
        assert_eq!(weekday_of(day(1970, 1, 1)), 3);
        assert_eq!(weekday_of(day(2026, 10, 19)), 0); // a Monday
        assert_eq!(weekday_of(day(2026, 10, 25)), 6);
        assert_eq!(weekday_of(-1), 2);
    }

    #[test]
    fn weekly_periods_follow_the_configured_week_start() {
        let wednesday = day(2026, 10, 21);
        assert_eq!(
            period_dates(Period::Weekly, wednesday, 0),
            (day(2026, 10, 19), day(2026, 10, 26))
        );
        // Sunday-first weeks.
        assert_eq!(
            period_dates(Period::Weekly, wednesday, 6),
            (day(2026, 10, 18), day(2026, 10, 25))
        );
        // The start day itself opens a new week; the day before closes the old one.
        assert_eq!(
            period_start(Period::Weekly, day(2026, 10, 19), 0),
            day(2026, 10, 19)
        );
        assert_eq!(
            period_start(Period::Weekly, day(2026, 10, 18), 0),
            day(2026, 10, 12)
        );
        // Saturday-first.
        assert_eq!(
            period_start(Period::Weekly, day(2026, 10, 24), 5),
            day(2026, 10, 24)
        );
    }

    #[test]
    fn monthly_periods_cross_year_ends_and_leap_days() {
        assert_eq!(
            period_dates(Period::Monthly, day(2026, 12, 31), 0),
            (day(2026, 12, 1), day(2027, 1, 1))
        );
        assert_eq!(
            period_dates(Period::Monthly, day(2024, 2, 29), 0),
            (day(2024, 2, 1), day(2024, 3, 1))
        );
        assert_eq!(
            previous_period_start(Period::Monthly, day(2024, 3, 1), 0),
            day(2024, 2, 1)
        );
    }

    #[test]
    fn daily_periods_are_single_days() {
        let d = day(2026, 3, 8);
        assert_eq!(period_dates(Period::Daily, d, 3), (d, d + 1));
        assert_eq!(previous_period_start(Period::Daily, d, 0), d - 1);
    }

    #[test]
    fn masks_select_weekdays() {
        let weekdays = 0b001_1111;
        assert!(mask_has(weekdays, 0) && mask_has(weekdays, 4));
        assert!(!mask_has(weekdays, 5) && !mask_has(weekdays, 6));
        assert!(!mask_has(ALL_DAYS, 7));
    }

    #[test]
    fn period_names_round_trip() {
        for p in Period::ALL {
            assert_eq!(Period::parse(p.as_str()), Some(p));
        }
        assert_eq!(Period::parse("hourly"), None);
    }
}
