//! `Calendar` adapter over the system time zone (chrono). Everything that depends on the
//! user's local weekday or hour (the Overview heatmap) goes through it, so the use cases stay
//! free of any zone.

use application::ports::Calendar;
use chrono::{Datelike, Local, Offset, TimeZone, Timelike};
use domain::{HourSlot, UtcMs};

const HOUR_MS: i64 = 3_600_000;

/// The machine's local time zone, DST aware.
#[derive(Debug, Clone, Copy, Default)]
pub struct ChronoLocalCalendar;

impl Calendar for ChronoLocalCalendar {
    fn hour_slot(&self, at: UtcMs) -> HourSlot {
        slot_in(&Local, at)
    }
}

/// UTC offset of `tz` at `at_ms`, in milliseconds; `None` outside chrono's range.
fn offset_ms<Tz: TimeZone>(tz: &Tz, at_ms: i64) -> Option<i64> {
    let instant = tz.timestamp_millis_opt(at_ms).single()?;
    Some(i64::from(instant.offset().fix().local_minus_utc()) * 1000)
}

/// Weekday/hour of `at` in `tz` and the instant the next local hour starts.
///
/// The next hour normally starts `3600 s - (minutes and seconds into the hour)` later, but a
/// zone can change offset inside that window (DST, in whole or half hours): then the slot ends
/// at the transition, so the caller re-reads the calendar and never counts a skipped hour or
/// stretches a repeated one.
fn slot_in<Tz: TimeZone>(tz: &Tz, at: UtcMs) -> HourSlot {
    let Some(local) = tz.timestamp_millis_opt(at.0).single() else {
        // Out of chrono's range: treat as UTC so callers still make progress.
        return utc_slot(at);
    };
    let offset = i64::from(local.offset().fix().local_minus_utc()) * 1000;
    let hour_start_local = (at.0 + offset).div_euclid(HOUR_MS) * HOUR_MS;
    let end = hour_start_local + HOUR_MS - offset;
    let next_boundary = if offset_ms(tz, end - 1) == Some(offset) {
        end
    } else {
        // First instant in `(at, end)` whose offset differs.
        let (mut low, mut high) = (at.0, end - 1);
        while low + 1 < high {
            let mid = low + (high - low) / 2;
            if offset_ms(tz, mid) == Some(offset) {
                low = mid;
            } else {
                high = mid;
            }
        }
        high
    };
    HourSlot {
        weekday: local.weekday().num_days_from_monday() as u8,
        hour: local.hour() as u8,
        next_boundary: UtcMs(next_boundary.max(at.0 + 1)),
    }
}

fn utc_slot(at: UtcMs) -> HourSlot {
    const DAY_MS: i64 = 24 * HOUR_MS;
    HourSlot {
        // 1970-01-01 was a Thursday.
        weekday: (at.0.div_euclid(DAY_MS) + 3).rem_euclid(7) as u8,
        hour: (at.0.rem_euclid(DAY_MS) / HOUR_MS) as u8,
        next_boundary: UtcMs(at.0.div_euclid(HOUR_MS) * HOUR_MS + HOUR_MS),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;

    const MIN: i64 = 60_000;

    #[test]
    fn a_half_hour_zone_slots_follow_the_local_clock() {
        // India, UTC+5:30. 1970-01-01 00:00 UTC is 05:30 local, a Thursday.
        let tz = FixedOffset::east_opt(5 * 3600 + 1800).unwrap();
        let slot = slot_in(&tz, UtcMs(0));
        assert_eq!((slot.weekday, slot.hour), (3, 5));
        // Local hour 5 ends at 06:00 local = 00:30 UTC.
        assert_eq!(slot.next_boundary, UtcMs(30 * MIN));
        let next = slot_in(&tz, slot.next_boundary);
        assert_eq!((next.weekday, next.hour), (3, 6));
    }

    #[test]
    fn a_negative_zone_crosses_into_the_previous_weekday() {
        // UTC-5: 1970-01-01 03:00 UTC is 22:00 local on Wednesday.
        let tz = FixedOffset::west_opt(5 * 3600).unwrap();
        let slot = slot_in(&tz, UtcMs(3 * 60 * MIN));
        assert_eq!((slot.weekday, slot.hour), (2, 22));
        assert_eq!(slot.next_boundary, UtcMs(4 * 60 * MIN));
    }

    #[test]
    fn local_slots_always_advance_and_never_exceed_an_hour_across_a_year() {
        // Whatever zone the machine runs in, walking a year hour by hour (DST included) must
        // make progress with pieces of at most one hour and a valid weekday/hour.
        let calendar = ChronoLocalCalendar;
        let start = 1_772_000_000_000_i64;
        let end = start + 366 * 24 * HOUR_MS;
        let mut at = start;
        let mut pieces = 0;
        while at < end {
            let slot = calendar.hour_slot(UtcMs(at));
            assert!(slot.weekday < 7 && slot.hour < 24);
            assert!(slot.next_boundary.0 > at);
            assert!(
                slot.next_boundary.0 - at <= HOUR_MS,
                "piece longer than an hour at {at}"
            );
            at = slot.next_boundary.0;
            pieces += 1;
        }
        // 8784 hours in a 366-day year, give or take the repeated/skipped DST hours.
        assert!((8_700..=8_900).contains(&pieces), "{pieces} pieces");
    }
}
