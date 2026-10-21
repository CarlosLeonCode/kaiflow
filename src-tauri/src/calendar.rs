//! `Calendar` adapter over the system time zone (chrono). Everything that depends on the
//! user's local weekday or hour (the Overview heatmap) goes through it, so the use cases stay
//! free of any zone.

use application::ports::Calendar;
use chrono::{Datelike, Local, NaiveDate, Offset, TimeZone, Timelike};
use domain::{HourSlot, UtcMs};

const HOUR_MS: i64 = 3_600_000;

/// The machine's local time zone, DST aware.
#[derive(Debug, Clone, Copy, Default)]
pub struct ChronoLocalCalendar;

impl Calendar for ChronoLocalCalendar {
    fn hour_slot(&self, at: UtcMs) -> HourSlot {
        slot_in(&Local, at)
    }

    fn local_day(&self, at: UtcMs) -> i64 {
        day_in(&Local, at)
    }

    fn start_of_day(&self, day: i64) -> UtcMs {
        start_of_day_in(&Local, day)
    }
}

/// First instant of local day number `day` (days since 1970-01-01) in `tz`. A midnight that a
/// DST jump skips starts the day at the first hour that exists; an ambiguous one (clocks
/// going back) uses the earlier instant.
fn start_of_day_in<Tz: TimeZone>(tz: &Tz, day: i64) -> UtcMs {
    let utc_fallback = UtcMs(day.saturating_mul(86_400_000));
    let Some(date) = i32::try_from(day + DAYS_FROM_CE_TO_EPOCH)
        .ok()
        .and_then(NaiveDate::from_num_days_from_ce_opt)
    else {
        return utc_fallback;
    };
    let Some(midnight) = date.and_hms_opt(0, 0, 0) else {
        return utc_fallback;
    };
    // Try the midnight, then each following hour (zones skip at most a few hours).
    (0..=3)
        .find_map(|hours| {
            tz.from_local_datetime(&(midnight + chrono::TimeDelta::hours(hours)))
                .earliest()
        })
        .map_or(utc_fallback, |t| UtcMs(t.timestamp_millis()))
}

/// Local calendar day of `at` in `tz`, as days since 1970-01-01.
fn day_in<Tz: TimeZone>(tz: &Tz, at: UtcMs) -> i64 {
    tz.timestamp_millis_opt(at.0).single().map_or_else(
        // Out of chrono's range: UTC keeps callers moving.
        || at.0.div_euclid(86_400_000),
        |local| i64::from(local.date_naive().num_days_from_ce()) - DAYS_FROM_CE_TO_EPOCH,
    )
}

/// `num_days_from_ce` of 1970-01-01.
const DAYS_FROM_CE_TO_EPOCH: i64 = 719_163;

/// The machine's current UTC offset as a readable label, e.g. `UTC+02:00`, for exports.
pub fn timezone_label() -> String {
    offset_label(Local::now().offset().fix().local_minus_utc())
}

fn offset_label(offset_secs: i32) -> String {
    let sign = if offset_secs < 0 { '-' } else { '+' };
    let minutes = offset_secs.unsigned_abs() / 60;
    format!("UTC{sign}{:02}:{:02}", minutes / 60, minutes % 60)
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
    fn the_local_day_changes_at_local_midnight() {
        // UTC-5: local midnight is 05:00 UTC.
        let tz = FixedOffset::west_opt(5 * 3600).unwrap();
        let day = 20_000_i64;
        let utc_midnight = day * 24 * 60 * MIN;
        assert_eq!(
            day_in(&tz, UtcMs(utc_midnight + 4 * 60 * MIN + 59 * MIN)),
            day - 1
        );
        assert_eq!(day_in(&tz, UtcMs(utc_midnight + 5 * 60 * MIN)), day);
        // Epoch day 0 and a pre-epoch instant.
        assert_eq!(day_in(&FixedOffset::east_opt(0).unwrap(), UtcMs(0)), 0);
        assert_eq!(day_in(&FixedOffset::east_opt(0).unwrap(), UtcMs(-1)), -1);
    }

    #[test]
    fn a_day_starts_at_local_midnight() {
        let day = 20_000_i64;
        let utc_midnight = day * 24 * 60 * MIN;
        // UTC-5: local midnight is 05:00 UTC; UTC+2: it is 22:00 UTC the day before.
        let west = FixedOffset::west_opt(5 * 3600).unwrap();
        assert_eq!(
            start_of_day_in(&west, day),
            UtcMs(utc_midnight + 5 * 60 * MIN)
        );
        let east = FixedOffset::east_opt(2 * 3600).unwrap();
        assert_eq!(
            start_of_day_in(&east, day),
            UtcMs(utc_midnight - 2 * 60 * MIN)
        );
        // It is the inverse of `day_in` at the boundary.
        for tz in [west, east] {
            let start = start_of_day_in(&tz, day);
            assert_eq!(day_in(&tz, start), day);
            assert_eq!(day_in(&tz, UtcMs(start.0 - 1)), day - 1);
        }
        assert_eq!(
            start_of_day_in(&FixedOffset::east_opt(0).unwrap(), 0),
            UtcMs(0)
        );
    }

    #[test]
    fn consecutive_local_days_in_the_system_zone_are_ascending_and_a_day_apart_or_so() {
        let calendar = ChronoLocalCalendar;
        let mut previous = calendar.start_of_day(19_000);
        for day in 19_001..19_400 {
            let start = calendar.start_of_day(day);
            let length = start.0 - previous.0;
            // 23 to 25 hours around DST changes.
            assert!(
                (22 * HOUR_MS..=26 * HOUR_MS).contains(&length),
                "day {day} lasted {length} ms"
            );
            assert_eq!(calendar.local_day(start), day);
            previous = start;
        }
    }

    #[test]
    fn offsets_are_labelled_for_humans() {
        assert_eq!(offset_label(0), "UTC+00:00");
        assert_eq!(offset_label(2 * 3600), "UTC+02:00");
        assert_eq!(offset_label(-(5 * 3600 + 1800)), "UTC-05:30");
        assert!(timezone_label().starts_with("UTC"));
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
