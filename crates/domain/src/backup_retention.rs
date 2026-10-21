//! Which daily backups to keep: the 7 newest plus the newest one of each of the 4 most recent
//! older weeks. Pure: days are local day numbers (days since 1970-01-01), never wall clocks.

use std::collections::BTreeSet;

/// Newest backups always kept, one per day.
pub const KEEP_DAILY: usize = 7;
/// Older weeks that keep their newest backup.
pub const KEEP_WEEKLY: usize = 4;

/// 1970-01-01 was a Thursday; with weeks starting on Monday (`week_start` 0) day 0 sits in
/// week offset 3 of its week.
const EPOCH_WEEKDAY_FROM_MONDAY: i64 = 3;

/// Index of the week `day` falls in; weeks start on `week_start` (0 = Monday .. 6 = Sunday).
pub fn week_index(day: i64, week_start: u8) -> i64 {
    (day + EPOCH_WEEKDAY_FROM_MONDAY - i64::from(week_start % 7)).div_euclid(7)
}

/// Days (of the given backups) that fall outside the retention policy, oldest first.
/// Duplicated days count once; the result never contains a kept day.
pub fn select_to_delete(days: &[i64], week_start: u8) -> Vec<i64> {
    let unique: BTreeSet<i64> = days.iter().copied().collect();
    let newest_first: Vec<i64> = unique.iter().rev().copied().collect();
    let mut keep: BTreeSet<i64> = newest_first.iter().take(KEEP_DAILY).copied().collect();

    let mut weeks_kept = BTreeSet::new();
    for day in newest_first.iter().skip(KEEP_DAILY) {
        let week = week_index(*day, week_start);
        // Descending iteration: the first day seen in a week is the newest of that week.
        if weeks_kept.len() < KEEP_WEEKLY && weeks_kept.insert(week) {
            keep.insert(*day);
        }
    }
    unique.into_iter().filter(|d| !keep.contains(d)).collect()
}

/// Civil date (year, month, day) of a day number. Howard Hinnant's `civil_from_days`.
pub fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Day number of a civil date (inverse of [`civil_from_days`]); `None` for impossible dates.
pub fn days_from_civil(year: i64, month: u32, day: u32) -> Option<i64> {
    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
        return None;
    }
    let y = year - i64::from(month <= 2);
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = i64::from(if month > 2 { month - 3 } else { month + 9 });
    let doy = (153 * mp + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn ten_daily_backups_keep_the_seven_newest_and_one_per_older_week() {
        // Days 100..=109; day 100 is a Sunday (week 14 from Monday: (100+3)/7 = 14).
        let days: Vec<i64> = (100..110).collect();
        let doomed = select_to_delete(&days, 0);
        // Newest 7 are 103..=109. Older 100, 101, 102: weeks (103/7=14, 104/7=14, 105/7=15)
        // -> 102 is the newest of week 15 and 101 the newest of week 14; 100 goes.
        assert_eq!(week_index(100, 0), 14);
        assert_eq!(week_index(102, 0), 15);
        assert_eq!(doomed, vec![100]);
    }

    #[test]
    fn long_histories_keep_four_older_weeks() {
        let days: Vec<i64> = (0..60).collect();
        let doomed = select_to_delete(&days, 0);
        let kept: Vec<i64> = days
            .iter()
            .copied()
            .filter(|d| !doomed.contains(d))
            .collect();
        assert_eq!(kept.len(), KEEP_DAILY + KEEP_WEEKLY);
        assert!(
            kept.iter()
                .rev()
                .take(7)
                .eq([59, 58, 57, 56, 55, 54, 53].iter())
        );
    }

    #[test]
    fn fewer_than_seven_keep_everything_and_duplicates_count_once() {
        assert!(select_to_delete(&[5, 5, 6, 7], 0).is_empty());
        assert!(select_to_delete(&[], 0).is_empty());
    }

    #[test]
    fn week_start_moves_the_week_boundary() {
        // Day 4 is Monday 1970-01-05, day 3 the Sunday before.
        assert_ne!(week_index(3, 0), week_index(4, 0));
        assert_eq!(week_index(3, 0), week_index(2, 0));
        // With Sunday-first weeks, Sunday and Monday share a week.
        assert_eq!(week_index(3, 6), week_index(4, 6));
    }

    #[test]
    fn civil_dates_round_trip_around_known_days() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
        assert_eq!(days_from_civil(2024, 2, 29), Some(19_782));
        assert_eq!(days_from_civil(2023, 2, 29), None);
        assert_eq!(days_from_civil(2023, 13, 1), None);
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
    }

    proptest! {
        #[test]
        fn civil_conversion_round_trips(days in -200_000i64..200_000) {
            let (y, m, d) = civil_from_days(days);
            prop_assert_eq!(days_from_civil(y, m, d), Some(days));
        }

        #[test]
        fn retention_keeps_the_newest_never_exceeds_the_cap_and_is_idempotent(
            days in proptest::collection::vec(0i64..400, 0..80),
            week_start in 0u8..7,
        ) {
            let doomed = select_to_delete(&days, week_start);
            let unique: BTreeSet<i64> = days.iter().copied().collect();
            let kept: Vec<i64> = unique.iter().copied().filter(|d| !doomed.contains(d)).collect();
            prop_assert!(kept.len() <= KEEP_DAILY + KEEP_WEEKLY);
            prop_assert!(doomed.iter().all(|d| unique.contains(d)));
            // The newest backups are never deleted.
            for newest in unique.iter().rev().take(KEEP_DAILY) {
                prop_assert!(kept.contains(newest));
            }
            // Applying the policy to what is left deletes nothing more.
            prop_assert!(select_to_delete(&kept, week_start).is_empty());
        }
    }
}
