//! V5: the Overview query on twelve synthetic months of history.
//!
//! Ignored by default (it writes ~290k rows and is only meaningful with optimizations):
//! `cargo test --release -p adapters-sqlite --test dashboard_bench -- --ignored --nocapture`

use std::time::{Duration, Instant};

use adapters_sqlite::{SqliteActivityRepository, SqliteReportRepository, open};
use application::ports::{ActivityRepository, Calendar};
use application::queries::{Queries, Range};
use domain::{ActivityId, ActivityRule, HourSlot, Productivity, UtcMs};
use rusqlite::params;
use std::sync::Arc;

const MINUTE: i64 = 60_000;
const HOUR: i64 = 60 * MINUTE;
const DAY: i64 = 24 * HOUR;
const DAYS: i64 = 365;
const SEGMENTS_PER_DAY: i64 = 800;
const BUDGET: Duration = Duration::from_millis(300);

/// UTC calendar: the benchmark measures the query and the fold, not the system time zone.
struct UtcCalendar;

impl Calendar for UtcCalendar {
    fn hour_slot(&self, at: UtcMs) -> HourSlot {
        HourSlot {
            weekday: ((at.0.div_euclid(DAY) + 3).rem_euclid(7)) as u8,
            hour: (at.0.rem_euclid(DAY) / HOUR) as u8,
            next_boundary: UtcMs(at.0.div_euclid(HOUR) * HOUR + HOUR),
        }
    }
}

fn day_ranges(from: i64, days: i64) -> Vec<Range> {
    (0..days)
        .map(|i| Range {
            from: UtcMs(from + i * DAY),
            to: UtcMs(from + (i + 1) * DAY),
        })
        .collect()
}

#[test]
#[ignore = "benchmark: run in release mode with --ignored"]
fn bench_90d_dashboard_over_twelve_months() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("bench.db");
    let conn = open(&path).unwrap();

    // Activities and rules, like a user with a handful of projects.
    let activities = SqliteActivityRepository::new(conn);
    let classes = [
        Productivity::Productive,
        Productivity::Neutral,
        Productivity::Distracting,
    ];
    let ids: Vec<ActivityId> = (0..8)
        .map(|i| {
            activities
                .create(&format!("Activity {i}"), "#3b82f6", classes[i % 3])
                .unwrap()
                .id
        })
        .collect();
    for (i, id) in ids.iter().enumerate() {
        activities
            .save_rule(&ActivityRule {
                id: 0,
                activity_id: *id,
                kind: domain::RuleKind::App(format!("app.{i}")),
                priority: 0,
            })
            .unwrap();
    }
    activities
        .save_rule(
            &ActivityRule::title_pattern(0, ids[1], r"(?i)^document 1\d\d ", None, 1).unwrap(),
        )
        .unwrap();
    drop(activities);

    // 365 days x 800 closed segments, back to back from 08:00, ~45 s each.
    let now = 1_790_000_000_000_i64 / DAY * DAY + 15 * HOUR;
    let first_day = now / DAY * DAY - (DAYS - 1) * DAY;
    let mut writer = rusqlite::Connection::open(&path).unwrap();
    let started = Instant::now();
    let tx = writer.transaction().unwrap();
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO segments(started_at, ended_at, heartbeat_at, app_id, app_name,
                                      window_title, end_reason, source)
                 VALUES (?1, ?2, ?2, ?3, ?4, ?5, 'focus_change', 'tracked')",
            )
            .unwrap();
        let mut state = 0x9e37_79b9_u32;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state
        };
        for day in 0..DAYS {
            let mut at = first_day + day * DAY + 8 * HOUR;
            for _ in 0..SEGMENTS_PER_DAY {
                let len = 20_000 + i64::from(next() % 50_000);
                let app = next() % 25;
                let title = next() % 400;
                stmt.execute(params![
                    at,
                    at + len,
                    format!("app.{app}"),
                    format!("App {app}"),
                    format!("Document {title} - sprint notes"),
                ])
                .unwrap();
                at += len;
            }
        }
    }
    tx.commit().unwrap();
    drop(writer);
    eprintln!(
        "seeded {} segments in {:?}",
        DAYS * SEGMENTS_PER_DAY,
        started.elapsed()
    );

    let activities = SqliteActivityRepository::new(open(&path).unwrap());
    let reports = SqliteReportRepository::open(&path).unwrap();
    let queries = Queries::new(Arc::new(reports), Arc::new(activities));

    // The last 90 days (daily buckets) against the 90 days before them.
    let today_end = now / DAY * DAY + DAY;
    let range = Range {
        from: UtcMs(today_end - 90 * DAY),
        to: UtcMs(today_end),
    };
    let previous = Range {
        from: UtcMs(range.from.0 - 90 * DAY),
        to: range.from,
    };
    let buckets = day_ranges(range.from.0, 90);

    let mut timings = Vec::new();
    for run in 0..3 {
        let began = Instant::now();
        let dashboard = queries
            .dashboard(range, &buckets, Some(previous), &UtcCalendar, UtcMs(now))
            .unwrap();
        let elapsed = began.elapsed();
        eprintln!(
            "run {run}: {elapsed:?} (90 days + 90 previous days; {} activities, {} titles)",
            dashboard.by_activity.len(),
            dashboard.top_titles.len(),
        );
        assert!(dashboard.total_ms > 0 && dashboard.previous_total_ms > 0);
        timings.push(elapsed);
    }

    // A recent short range must not pay for the history behind it (the point of V4).
    let began = Instant::now();
    let today = Range {
        from: UtcMs(today_end - DAY),
        to: UtcMs(today_end),
    };
    queries
        .dashboard(today, &[today], None, &UtcCalendar, UtcMs(now))
        .unwrap();
    let day_elapsed = began.elapsed();
    eprintln!("one recent day: {day_elapsed:?}");

    let worst = timings.iter().max().copied().unwrap();
    assert!(
        worst <= BUDGET,
        "90 day dashboard took {worst:?}, budget {BUDGET:?}; consider pre-aggregation"
    );
    assert!(day_elapsed < BUDGET / 4, "recent day took {day_elapsed:?}");
}
