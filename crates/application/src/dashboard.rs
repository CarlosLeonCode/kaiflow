//! The Overview query: one load, one pass.
//!
//! `Queries::dashboard` reads the segments of the range (and of the previous period, when one
//! is asked for) with a single repository call and folds them into every figure the Overview
//! shows: totals, activity and app breakdowns, top window titles, stacked buckets, the hour by
//! weekday heatmap, the trend against the previous period and the focus ratio.

use std::collections::HashMap;

use domain::{
    Activity, ActivityId, FocusRatio, Productivity, Segment, Trend, UNASSIGNED, UtcMs, classify,
    clip_to_range, focus_ratio, trend,
};

use crate::ports::Calendar;
use crate::queries::{
    ActivityTotal, AppTotal, Queries, QueryError, Range, TitleTotal, activity_label,
};

/// Window titles kept in the result (busiest first).
pub const DASHBOARD_TOP_TITLES: usize = 10;
/// Apps kept in the result (busiest first); the totals still count every app.
pub const DASHBOARD_TOP_APPS: usize = 50;

/// Hours in a heatmap row, and rows (Monday first).
pub const HEATMAP_HOURS: usize = 24;
pub const HEATMAP_DAYS: usize = 7;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DashboardActivity {
    pub total: ActivityTotal,
    pub productivity: Productivity,
}

/// One bucket (an hour, a day, a week...) with its time split by activity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StackedBucket {
    pub range: Range,
    pub total_ms: i64,
    /// Biggest first; only activities with time in the bucket.
    pub by_activity: Vec<(ActivityId, i64)>,
}

/// Milliseconds per productivity class (the neutral share included).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ProductivityTotals {
    pub productive_ms: i64,
    pub neutral_ms: i64,
    pub distracting_ms: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Dashboard {
    pub range: Range,
    pub total_ms: i64,
    /// Tracked time of the previous period (`0` when none was requested).
    pub previous_total_ms: i64,
    pub trend: Trend,
    pub by_activity: Vec<DashboardActivity>,
    pub by_app: Vec<AppTotal>,
    pub top_titles: Vec<TitleTotal>,
    pub buckets: Vec<StackedBucket>,
    /// Local time of day by weekday: index `weekday * 24 + hour`, weekday 0 = Monday.
    pub heatmap: Vec<i64>,
    pub productivity: ProductivityTotals,
    pub focus_ratio: FocusRatio,
    /// Short idle gaps discarded by the app itself in the range.
    pub auto_discarded_gaps: u32,
}

#[derive(Default)]
struct AppAcc<'a> {
    name: Option<&'a str>,
    total_ms: i64,
}

#[derive(Default)]
struct TitleAcc<'a> {
    app_name: Option<&'a str>,
    total_ms: i64,
    spans: usize,
}

impl Queries {
    /// Everything the Overview shows for `range` in one pass.
    ///
    /// `buckets` must be ascending and non-overlapping (the frontend sends hours, days or
    /// weeks); spans crossing a bucket edge are shared between buckets. `previous` is the
    /// period to compare with; both periods are read with one repository call.
    pub fn dashboard(
        &self,
        range: Range,
        buckets: &[Range],
        previous: Option<Range>,
        calendar: &dyn Calendar,
        now: UtcMs,
    ) -> Result<Dashboard, QueryError> {
        if range.from >= range.to || previous.is_some_and(|p| p.from >= p.to) {
            return Err(QueryError::InvalidRange);
        }
        let rules = self.activities.list_rules()?;
        let activities = self.activities.list()?;
        let known: HashMap<ActivityId, &Activity> = activities.iter().map(|a| (a.id, a)).collect();

        let load_from = previous.map_or(range.from, |p| p.from.min(range.from));
        let load_to = previous.map_or(range.to, |p| p.to.max(range.to));
        let mut segments = self.reports.segments_in_range(load_from, load_to)?;
        segments.sort_by_key(|s| (s.started_at, s.id));

        // `classify` only looks at the app and the title, so one answer per pair is enough.
        let mut memo: HashMap<(Option<&str>, Option<&str>), ActivityId> = HashMap::new();
        let mut by_app: HashMap<Option<&str>, AppAcc<'_>> = HashMap::new();
        let mut by_activity: HashMap<ActivityId, i64> = HashMap::new();
        let mut by_title: HashMap<(Option<&str>, &str), TitleAcc<'_>> = HashMap::new();
        let mut bucket_acc: Vec<HashMap<ActivityId, i64>> = vec![HashMap::new(); buckets.len()];
        let mut heatmap = vec![0i64; HEATMAP_DAYS * HEATMAP_HOURS];
        let mut total_ms = 0;
        let mut previous_total_ms = 0;

        for segment in &segments {
            if let Some(prev) = previous
                && let Some(span) = clip_to_range(segment, prev.from, prev.to, now)
            {
                previous_total_ms += span.duration_ms();
            }
            let Some(span) = clip_to_range(segment, range.from, range.to, now) else {
                continue;
            };
            let ms = span.duration_ms();
            total_ms += ms;

            let activity = resolve(segment, &rules, &known, &mut memo);
            *by_activity.entry(activity).or_default() += ms;

            let app = by_app.entry(segment.app_id.as_deref()).or_default();
            app.total_ms += ms;
            if let Some(name) = segment.app_name.as_deref() {
                app.name = Some(name);
            }
            if let Some(title) = segment.window_title.as_deref() {
                let entry = by_title
                    .entry((segment.app_id.as_deref(), title))
                    .or_default();
                entry.total_ms += ms;
                entry.spans += 1;
                entry.app_name = segment.app_name.as_deref().or(entry.app_name);
            }

            add_to_buckets(buckets, &mut bucket_acc, span.start, span.end, activity);
            add_to_heatmap(&mut heatmap, calendar, span.start, span.end);
        }

        let mut productivity = ProductivityTotals::default();
        let mut by_activity_rows: Vec<DashboardActivity> = by_activity
            .into_iter()
            .map(|(id, total_ms)| {
                let (name, color) = activity_label(id, &activities);
                let class = known
                    .get(&id)
                    .map_or(Productivity::Neutral, |a| a.productivity);
                match class {
                    Productivity::Productive => productivity.productive_ms += total_ms,
                    Productivity::Neutral => productivity.neutral_ms += total_ms,
                    Productivity::Distracting => productivity.distracting_ms += total_ms,
                }
                DashboardActivity {
                    total: ActivityTotal {
                        activity_id: id,
                        name,
                        color,
                        total_ms,
                    },
                    productivity: class,
                }
            })
            .collect();
        by_activity_rows.sort_by(|a, b| {
            b.total
                .total_ms
                .cmp(&a.total.total_ms)
                .then_with(|| a.total.activity_id.cmp(&b.total.activity_id))
        });

        let mut by_app_rows: Vec<AppTotal> = by_app
            .into_iter()
            .map(|(app_id, acc)| AppTotal {
                app_id: app_id.map(str::to_owned),
                app_name: acc.name.unwrap_or_default().to_owned(),
                total_ms: acc.total_ms,
            })
            .collect();
        by_app_rows.sort_by(|a, b| {
            b.total_ms
                .cmp(&a.total_ms)
                .then_with(|| a.app_name.cmp(&b.app_name))
                .then_with(|| a.app_id.cmp(&b.app_id))
        });
        by_app_rows.truncate(DASHBOARD_TOP_APPS);

        let mut title_rows: Vec<TitleTotal> = by_title
            .into_iter()
            .map(|((app_id, title), acc)| TitleTotal {
                app_id: app_id.map(str::to_owned),
                app_name: acc.app_name.map(str::to_owned),
                window_title: Some(title.to_owned()),
                total_ms: acc.total_ms,
                spans: acc.spans,
            })
            .collect();
        title_rows.sort_by(|a, b| {
            b.total_ms
                .cmp(&a.total_ms)
                .then_with(|| a.window_title.cmp(&b.window_title))
                .then_with(|| a.app_id.cmp(&b.app_id))
        });
        title_rows.truncate(DASHBOARD_TOP_TITLES);

        let stacked = buckets
            .iter()
            .zip(bucket_acc)
            .map(|(bucket, acc)| {
                let mut by_activity: Vec<(ActivityId, i64)> = acc.into_iter().collect();
                by_activity.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
                StackedBucket {
                    range: *bucket,
                    total_ms: by_activity.iter().map(|(_, ms)| ms).sum(),
                    by_activity,
                }
            })
            .collect();

        Ok(Dashboard {
            range,
            total_ms,
            previous_total_ms,
            trend: trend(total_ms, previous_total_ms),
            by_activity: by_activity_rows,
            by_app: by_app_rows,
            top_titles: title_rows,
            buckets: stacked,
            heatmap,
            productivity,
            focus_ratio: focus_ratio(productivity.productive_ms, productivity.distracting_ms),
            auto_discarded_gaps: self.reports.auto_discarded_gaps(range.from, range.to)?,
        })
    }
}

/// Activity of a segment: a manual assignment wins, otherwise the rules (memoized per app and
/// title). A rule or assignment pointing at a deleted activity counts as unassigned.
pub(crate) fn resolve<'a>(
    segment: &'a Segment,
    rules: &[domain::ActivityRule],
    known: &HashMap<ActivityId, &Activity>,
    memo: &mut HashMap<(Option<&'a str>, Option<&'a str>), ActivityId>,
) -> ActivityId {
    let activity = match segment.activity_id {
        Some(manual) => manual,
        None => *memo
            .entry((segment.app_id.as_deref(), segment.window_title.as_deref()))
            .or_insert_with(|| classify(segment, rules)),
    };
    if activity != UNASSIGNED && !known.contains_key(&activity) {
        UNASSIGNED
    } else {
        activity
    }
}

/// Adds `[start, end)` to every bucket it overlaps (buckets are ascending).
fn add_to_buckets(
    buckets: &[Range],
    acc: &mut [HashMap<ActivityId, i64>],
    start: UtcMs,
    end: UtcMs,
    activity: ActivityId,
) {
    let first = buckets.partition_point(|b| b.to <= start);
    for (bucket, acc) in buckets[first..].iter().zip(&mut acc[first..]) {
        if bucket.from >= end {
            break;
        }
        let overlap = end.min(bucket.to).since(start.max(bucket.from));
        if overlap > 0 {
            *acc.entry(activity).or_default() += overlap;
        }
    }
}

/// Cuts `[start, end)` at every local hour boundary and adds each piece to its weekday/hour.
fn add_to_heatmap(heatmap: &mut [i64], calendar: &dyn Calendar, start: UtcMs, end: UtcMs) {
    let mut cursor = start;
    while cursor < end {
        let slot = calendar.hour_slot(cursor);
        // A calendar that does not advance would loop forever: take the rest in one piece.
        let piece_end = if slot.next_boundary > cursor {
            slot.next_boundary.min(end)
        } else {
            end
        };
        let index = usize::from(slot.weekday % 7) * HEATMAP_HOURS + usize::from(slot.hour % 24);
        heatmap[index] += piece_end.since(cursor);
        cursor = piece_end;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fakes::{FakeActivities, FakeStore, FixedCalendar};
    use crate::ports::ActivityRepository;
    use domain::{ActivityRule, EndReason, RuleKind, SegmentId, SegmentSource};
    use std::sync::Arc;

    const MIN: i64 = 60_000;
    const HOUR: i64 = 60 * MIN;
    const DAY: i64 = 24 * HOUR;

    fn seg(start: i64, end: i64, app: &str, title: Option<&str>, manual: Option<i64>) -> Segment {
        Segment {
            id: SegmentId(0),
            started_at: UtcMs(start),
            ended_at: Some(UtcMs(end)),
            heartbeat_at: UtcMs(start),
            app_id: Some(app.into()),
            app_name: Some(app.to_uppercase()),
            window_title: title.map(Into::into),
            end_reason: Some(EndReason::FocusChange),
            source: SegmentSource::Tracked,
            activity_id: manual.map(ActivityId),
        }
    }

    fn range(from: i64, to: i64) -> Range {
        Range {
            from: UtcMs(from),
            to: UtcMs(to),
        }
    }

    /// Ids: 1 Unassigned (neutral), 2 Work (productive), 3 Social (distracting).
    fn setup() -> (Queries, FakeStore, FakeActivities) {
        let store = FakeStore::default();
        let cats = FakeActivities::default();
        cats.create("Unassigned", "#999999", Productivity::Neutral)
            .unwrap();
        cats.create("Work", "#00ff00", Productivity::Productive)
            .unwrap();
        cats.create("Social", "#0000ff", Productivity::Distracting)
            .unwrap();
        let q = Queries::new(Arc::new(store.clone()), Arc::new(cats.clone()));
        (q, store, cats)
    }

    fn app_rule(id: i64, activity: i64, app: &str) -> ActivityRule {
        ActivityRule {
            id,
            activity_id: ActivityId(activity),
            kind: RuleKind::App(app.into()),
            priority: 0,
        }
    }

    fn utc() -> FixedCalendar {
        FixedCalendar::fixed(0)
    }

    #[test]
    fn a_dashboard_with_a_previous_period_loads_segments_once() {
        let (q, store, _) = setup();
        store.seed_segment(seg(0, HOUR, "a", None, None));
        store.seed_segment(seg(2 * DAY, 2 * DAY + HOUR, "a", None, None));
        let buckets = [range(2 * DAY, 3 * DAY)];
        q.dashboard(
            range(2 * DAY, 3 * DAY),
            &buckets,
            Some(range(DAY, 2 * DAY)),
            &utc(),
            UtcMs(0),
        )
        .unwrap();
        assert_eq!(store.range_loads(), 1);
    }

    #[test]
    fn totals_breakdowns_and_productivity_come_from_one_pass() {
        let (q, store, cats) = setup();
        cats.save_rule(&app_rule(1, 2, "code")).unwrap();
        cats.save_rule(&app_rule(2, 3, "chat")).unwrap();
        store.seed_segment(seg(0, 30 * MIN, "code", Some("main.rs"), None));
        store.seed_segment(seg(30 * MIN, 40 * MIN, "chat", Some("general"), None));
        store.seed_segment(seg(40 * MIN, 50 * MIN, "misc", None, None));
        store.seed_segment(seg(50 * MIN, 60 * MIN, "misc", None, Some(2)));

        let d = q
            .dashboard(range(0, HOUR), &[], None, &utc(), UtcMs(0))
            .unwrap();
        assert_eq!(d.total_ms, 60 * MIN);
        let activities: Vec<_> = d
            .by_activity
            .iter()
            .map(|a| (a.total.name.as_str(), a.productivity, a.total.total_ms))
            .collect();
        assert_eq!(
            activities,
            vec![
                ("Work", Productivity::Productive, 40 * MIN),
                ("Unassigned", Productivity::Neutral, 10 * MIN),
                ("Social", Productivity::Distracting, 10 * MIN),
            ]
        );
        assert_eq!(
            d.productivity,
            ProductivityTotals {
                productive_ms: 40 * MIN,
                neutral_ms: 10 * MIN,
                distracting_ms: 10 * MIN
            }
        );
        assert_eq!(d.focus_ratio, FocusRatio::Ratio(0.8));
        let apps: Vec<_> = d
            .by_app
            .iter()
            .map(|a| (a.app_name.as_str(), a.total_ms))
            .collect();
        assert_eq!(
            apps,
            vec![("CODE", 30 * MIN), ("MISC", 20 * MIN), ("CHAT", 10 * MIN)]
        );
    }

    #[test]
    fn rules_resolve_once_per_app_and_title_pair() {
        // Two segments of the same pair must land in the same activity even when only a
        // title rule distinguishes them from the app default.
        let (q, store, cats) = setup();
        cats.save_rule(&app_rule(1, 2, "browser")).unwrap();
        cats.save_rule(
            &ActivityRule::title_pattern(2, ActivityId(3), "(?i)video", None, 0).unwrap(),
        )
        .unwrap();
        for i in 0..4 {
            store.seed_segment(seg(
                i * 10 * MIN,
                (i + 1) * 10 * MIN,
                "browser",
                Some("A video"),
                None,
            ));
        }
        store.seed_segment(seg(40 * MIN, 50 * MIN, "browser", Some("Docs"), None));
        let d = q
            .dashboard(range(0, HOUR), &[], None, &utc(), UtcMs(0))
            .unwrap();
        let by: Vec<_> = d
            .by_activity
            .iter()
            .map(|a| (a.total.name.as_str(), a.total.total_ms))
            .collect();
        assert_eq!(by, vec![("Social", 40 * MIN), ("Work", 10 * MIN)]);
    }

    #[test]
    fn an_empty_previous_period_has_no_comparison() {
        let (q, store, _) = setup();
        store.seed_segment(seg(DAY, DAY + HOUR, "a", None, None));
        let d = q
            .dashboard(
                range(DAY, 2 * DAY),
                &[],
                Some(range(0, DAY)),
                &utc(),
                UtcMs(0),
            )
            .unwrap();
        assert_eq!(d.trend, Trend::NoComparison);
        assert_eq!(d.previous_total_ms, 0);
    }

    #[test]
    fn trend_compares_with_the_previous_period() {
        let (q, store, _) = setup();
        store.seed_segment(seg(0, 2 * HOUR, "a", None, None));
        // Crosses into the current period: only its part inside each period counts.
        store.seed_segment(seg(DAY - HOUR, DAY + HOUR, "a", None, None));
        store.seed_segment(seg(DAY + HOUR, DAY + 4 * HOUR, "a", None, None));
        let d = q
            .dashboard(
                range(DAY, 2 * DAY),
                &[],
                Some(range(0, DAY)),
                &utc(),
                UtcMs(0),
            )
            .unwrap();
        assert_eq!(d.total_ms, 4 * HOUR);
        assert_eq!(d.previous_total_ms, 3 * HOUR);
        assert_eq!(
            d.trend,
            Trend::Change {
                delta_ms: HOUR,
                pct: 33
            }
        );
    }

    #[test]
    fn only_neutral_time_gives_no_focus_signal() {
        let (q, store, _) = setup();
        store.seed_segment(seg(0, HOUR, "misc", None, None));
        let d = q
            .dashboard(range(0, HOUR), &[], None, &utc(), UtcMs(0))
            .unwrap();
        assert_eq!(d.focus_ratio, FocusRatio::NoSignal);
    }

    #[test]
    fn an_empty_range_is_a_valid_empty_dashboard() {
        let (q, _, _) = setup();
        let d = q
            .dashboard(range(0, DAY), &[range(0, DAY)], None, &utc(), UtcMs(0))
            .unwrap();
        assert_eq!(d.total_ms, 0);
        assert!(d.by_activity.is_empty() && d.by_app.is_empty() && d.top_titles.is_empty());
        assert_eq!(d.heatmap.iter().sum::<i64>(), 0);
        assert_eq!(d.buckets[0].total_ms, 0);
        assert_eq!(d.focus_ratio, FocusRatio::NoSignal);
    }

    #[test]
    fn invalid_ranges_are_rejected() {
        let (q, _, _) = setup();
        assert_eq!(
            q.dashboard(range(5, 5), &[], None, &utc(), UtcMs(0)),
            Err(QueryError::InvalidRange)
        );
        assert_eq!(
            q.dashboard(range(0, 5), &[], Some(range(9, 3)), &utc(), UtcMs(0)),
            Err(QueryError::InvalidRange)
        );
    }

    #[test]
    fn buckets_are_stacked_by_activity_and_share_spans_that_cross_them() {
        let (q, store, cats) = setup();
        cats.save_rule(&app_rule(1, 2, "code")).unwrap();
        store.seed_segment(seg(DAY - 10 * MIN, DAY + 20 * MIN, "code", None, None));
        store.seed_segment(seg(DAY + 30 * MIN, DAY + 40 * MIN, "misc", None, None));
        let buckets = [range(0, DAY), range(DAY, 2 * DAY)];
        let d = q
            .dashboard(range(0, 2 * DAY), &buckets, None, &utc(), UtcMs(0))
            .unwrap();
        assert_eq!(d.buckets[0].by_activity, vec![(ActivityId(2), 10 * MIN)]);
        assert_eq!(
            d.buckets[1].by_activity,
            vec![(ActivityId(2), 20 * MIN), (ActivityId(1), 10 * MIN)]
        );
        assert_eq!(d.buckets[1].total_ms, 30 * MIN);
        assert_eq!(d.total_ms, 40 * MIN);
    }

    #[test]
    fn top_titles_are_busiest_first_capped_and_skip_untitled_time() {
        let (q, store, _) = setup();
        let mut at = 0;
        for i in 0..15 {
            // Title `t{i}` gets (i + 1) minutes.
            store.seed_segment(seg(
                at,
                at + (i + 1) * MIN,
                "a",
                Some(&format!("t{i}")),
                None,
            ));
            at += (i + 1) * MIN;
        }
        store.seed_segment(seg(at, at + 500 * MIN, "a", None, None));
        let d = q
            .dashboard(range(0, DAY), &[], None, &utc(), UtcMs(0))
            .unwrap();
        assert_eq!(d.top_titles.len(), DASHBOARD_TOP_TITLES);
        assert_eq!(d.top_titles[0].window_title.as_deref(), Some("t14"));
        assert_eq!(d.top_titles[0].total_ms, 15 * MIN);
        assert!(d.top_titles.iter().all(|t| t.window_title.is_some()));
    }

    #[test]
    fn a_deleted_activity_counts_as_unassigned() {
        let (q, store, _) = setup();
        store.seed_segment(seg(0, HOUR, "a", None, Some(99)));
        let d = q
            .dashboard(range(0, HOUR), &[], None, &utc(), UtcMs(0))
            .unwrap();
        assert_eq!(d.by_activity[0].total.activity_id, UNASSIGNED);
    }

    #[test]
    fn the_heatmap_uses_local_weekday_and_hour() {
        let (q, store, _) = setup();
        // 1970-01-05 is a Monday. 22:30 UTC to 00:30 UTC next day, viewed at UTC+2:
        // local 00:30 to 02:30 on Tuesday (weekday 1).
        let monday = 4 * DAY;
        store.seed_segment(seg(
            monday + 22 * HOUR + 30 * MIN,
            monday + 24 * HOUR + 30 * MIN,
            "a",
            None,
            None,
        ));
        let cal = FixedCalendar::fixed(2 * HOUR);
        let d = q
            .dashboard(range(monday, monday + 2 * DAY), &[], None, &cal, UtcMs(0))
            .unwrap();
        let cell = |weekday: usize, hour: usize| d.heatmap[weekday * 24 + hour];
        assert_eq!(cell(1, 0), 30 * MIN);
        assert_eq!(cell(1, 1), HOUR);
        assert_eq!(cell(1, 2), 30 * MIN);
        assert_eq!(d.heatmap.iter().sum::<i64>(), d.total_ms);
    }

    #[test]
    fn the_heatmap_follows_a_dst_jump_without_inventing_the_skipped_hour() {
        let (q, store, _) = setup();
        // US spring forward: 2026-03-08 07:00 UTC, offset -5 h to -4 h; a Sunday (weekday 6).
        let jump = 1_772_953_200_000;
        store.seed_segment(seg(jump - 30 * MIN, jump + 30 * MIN, "a", None, None));
        let cal = FixedCalendar::with_transitions(&[(i64::MIN, -5 * HOUR), (jump, -4 * HOUR)]);
        let d = q
            .dashboard(range(jump - DAY, jump + DAY), &[], None, &cal, UtcMs(0))
            .unwrap();
        let sunday = |hour: usize| d.heatmap[6 * 24 + hour];
        // 01:30 -> 02:00 before the jump, then the clock reads 03:00.
        assert_eq!(sunday(1), 30 * MIN);
        assert_eq!(sunday(2), 0);
        assert_eq!(sunday(3), 30 * MIN);
        assert_eq!(d.heatmap.iter().sum::<i64>(), HOUR);
    }

    #[test]
    fn a_stuck_calendar_cannot_loop_forever() {
        struct Stuck;
        impl Calendar for Stuck {
            fn hour_slot(&self, at: UtcMs) -> domain::HourSlot {
                domain::HourSlot {
                    weekday: 0,
                    hour: 0,
                    next_boundary: at,
                }
            }
        }
        let (q, store, _) = setup();
        store.seed_segment(seg(0, HOUR, "a", None, None));
        let d = q
            .dashboard(range(0, DAY), &[], None, &Stuck, UtcMs(0))
            .unwrap();
        assert_eq!(d.heatmap[0], HOUR);
    }
}
