//! Read use cases behind the UI (design section 8): today summary, range reports,
//! timeline and title detail. Ranges are UTC `[from, to)` computed by the frontend (local
//! day boundaries, DST included); activities are resolved at query time (R9.2).

use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

use domain::{
    Activity, ActivityId, EndReason, Segment, SegmentId, SegmentSource, UNASSIGNED, UtcMs,
    classify, clip_to_range, split_at_boundaries,
};

use crate::ports::{ActivityRepository, PortError, ReportRepository};

/// Name shown for the system activity when the repository does not list it.
pub const UNASSIGNED_NAME: &str = "Unassigned";
/// Neutral color used when an activity cannot be resolved.
pub const UNASSIGNED_COLOR: &str = "#9ca3af";

/// Half-open UTC range `[from, to)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Range {
    pub from: UtcMs,
    pub to: UtcMs,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueryError {
    /// `from` is not before `to`.
    InvalidRange,
    Port(PortError),
}

impl fmt::Display for QueryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRange => f.write_str("range start must be before its end"),
            Self::Port(e) => e.fmt(f),
        }
    }
}

impl std::error::Error for QueryError {}

impl From<PortError> for QueryError {
    fn from(e: PortError) -> Self {
        Self::Port(e)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppTotal {
    /// `None` for time assigned manually to an activity.
    pub app_id: Option<String>,
    /// Empty for manually assigned time (no app); the UI supplies that label.
    pub app_name: String,
    pub total_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivityTotal {
    pub activity_id: ActivityId,
    pub name: String,
    pub color: String,
    pub total_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BucketTotal {
    pub range: Range,
    pub total_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    pub by_app: Vec<AppTotal>,
    pub by_activity: Vec<ActivityTotal>,
    pub by_bucket: Vec<BucketTotal>,
    pub total_ms: i64,
}

/// One clipped span of the timeline with its activity resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimelineItem {
    pub segment_id: SegmentId,
    pub start: UtcMs,
    pub end: UtcMs,
    pub app_id: Option<String>,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub activity_id: ActivityId,
    pub activity_name: String,
    pub activity_color: String,
    pub source: SegmentSource,
    /// Reason of the segment's own end; `None` when the span was clipped or is still open.
    pub end_reason: Option<EndReason>,
    pub open: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TitleTotal {
    pub app_id: Option<String>,
    pub window_title: Option<String>,
    pub total_ms: i64,
    pub spans: usize,
}

pub struct Queries {
    reports: Arc<dyn ReportRepository>,
    activities: Arc<dyn ActivityRepository>,
}

/// A segment, its clipped span and its resolved activity.
struct Resolved {
    segment: Segment,
    start: UtcMs,
    end: UtcMs,
    activity: ActivityId,
}

impl Resolved {
    fn duration_ms(&self) -> i64 {
        self.end.since(self.start)
    }
}

impl Queries {
    pub fn new(
        reports: Arc<dyn ReportRepository>,
        activities: Arc<dyn ActivityRepository>,
    ) -> Self {
        Self {
            reports,
            activities,
        }
    }

    /// Totals for one day plus its `top_apps` busiest apps (popover and "Hoy").
    pub fn today_summary(
        &self,
        day: Range,
        top_apps: usize,
        now: UtcMs,
    ) -> Result<Report, QueryError> {
        let mut report = self.range_report(day, &[day], now)?;
        report.by_app.truncate(top_apps);
        Ok(report)
    }

    /// Totals by app, activity and caller-provided bucket (day buckets for week/month
    /// history). Spans crossing a bucket boundary are shared between buckets (R8.3).
    pub fn range_report(
        &self,
        range: Range,
        buckets: &[Range],
        now: UtcMs,
    ) -> Result<Report, QueryError> {
        let (resolved, cats) = self.load(range, now)?;

        let mut by_app: HashMap<Option<String>, AppTotal> = HashMap::new();
        let mut by_cat: HashMap<ActivityId, i64> = HashMap::new();
        let mut by_bucket = vec![0i64; buckets.len()];
        let boundaries: Vec<UtcMs> = buckets.iter().flat_map(|b| [b.from, b.to]).collect();
        let mut total_ms = 0;

        for r in &resolved {
            let ms = r.duration_ms();
            total_ms += ms;
            let entry = by_app
                .entry(r.segment.app_id.clone())
                .or_insert_with(|| AppTotal {
                    app_id: r.segment.app_id.clone(),
                    app_name: app_label(&r.segment),
                    total_ms: 0,
                });
            entry.total_ms += ms;
            if let Some(name) = &r.segment.app_name {
                entry.app_name.clone_from(name);
            }
            *by_cat.entry(r.activity).or_default() += ms;

            let span = domain::ClippedSpan {
                start: r.start,
                end: r.end,
            };
            for part in split_at_boundaries(span, &boundaries) {
                if let Some(i) = buckets
                    .iter()
                    .position(|b| b.from <= part.start && part.start < b.to)
                {
                    by_bucket[i] += part.duration_ms();
                }
            }
        }

        let mut by_app: Vec<AppTotal> = by_app.into_values().collect();
        by_app.sort_by(|a, b| {
            b.total_ms
                .cmp(&a.total_ms)
                .then_with(|| a.app_name.cmp(&b.app_name))
        });
        let mut by_activity: Vec<ActivityTotal> = by_cat
            .into_iter()
            .map(|(id, total_ms)| {
                let (name, color) = activity_label(id, &cats);
                ActivityTotal {
                    activity_id: id,
                    name,
                    color,
                    total_ms,
                }
            })
            .collect();
        by_activity.sort_by(|a, b| {
            b.total_ms
                .cmp(&a.total_ms)
                .then_with(|| a.activity_id.cmp(&b.activity_id))
        });

        Ok(Report {
            by_app,
            by_activity,
            by_bucket: buckets
                .iter()
                .zip(by_bucket)
                .map(|(range, total_ms)| BucketTotal {
                    range: *range,
                    total_ms,
                })
                .collect(),
            total_ms,
        })
    }

    /// Clipped spans in chronological order with the activity resolved (timeline, CSV).
    pub fn timeline(&self, range: Range, now: UtcMs) -> Result<Vec<TimelineItem>, QueryError> {
        let (resolved, cats) = self.load(range, now)?;
        Ok(resolved
            .into_iter()
            .map(|r| {
                let (activity_name, activity_color) = activity_label(r.activity, &cats);
                let own_end = r.segment.ended_at;
                TimelineItem {
                    segment_id: r.segment.id,
                    start: r.start,
                    end: r.end,
                    open: own_end.is_none(),
                    end_reason: if own_end == Some(r.end) {
                        r.segment.end_reason
                    } else {
                        None
                    },
                    app_id: r.segment.app_id,
                    app_name: r.segment.app_name,
                    window_title: r.segment.window_title,
                    activity_id: r.activity,
                    activity_name,
                    activity_color,
                    source: r.segment.source,
                }
            })
            .collect())
    }

    /// CSV of the range's timeline (R8.2, R8.4); a range without data gives only the header.
    pub fn export_csv(&self, range: Range, now: UtcMs) -> Result<String, QueryError> {
        Ok(crate::csv::render_csv(&self.timeline(range, now)?))
    }

    /// Time per window title, optionally for a single app, busiest first (R7.1).
    pub fn title_detail(
        &self,
        range: Range,
        app_id: Option<&str>,
        now: UtcMs,
    ) -> Result<Vec<TitleTotal>, QueryError> {
        let (resolved, _) = self.load(range, now)?;
        let mut groups: HashMap<(Option<String>, Option<String>), TitleTotal> = HashMap::new();
        for r in resolved
            .iter()
            .filter(|r| app_id.is_none_or(|a| r.segment.app_id.as_deref() == Some(a)))
        {
            let key = (r.segment.app_id.clone(), r.segment.window_title.clone());
            let entry = groups.entry(key).or_insert_with(|| TitleTotal {
                app_id: r.segment.app_id.clone(),
                window_title: r.segment.window_title.clone(),
                total_ms: 0,
                spans: 0,
            });
            entry.total_ms += r.duration_ms();
            entry.spans += 1;
        }
        let mut out: Vec<TitleTotal> = groups.into_values().collect();
        out.sort_by(|a, b| {
            b.total_ms
                .cmp(&a.total_ms)
                .then_with(|| a.window_title.cmp(&b.window_title))
        });
        Ok(out)
    }

    /// Loads, clips and classifies the segments of a range, ordered by start then id.
    fn load(&self, range: Range, now: UtcMs) -> Result<(Vec<Resolved>, Vec<Activity>), QueryError> {
        if range.from >= range.to {
            return Err(QueryError::InvalidRange);
        }
        let rules = self.activities.list_rules()?;
        let cats = self.activities.list()?;
        let mut segments = self.reports.segments_in_range(range.from, range.to)?;
        segments.sort_by_key(|s| (s.started_at, s.id));

        let resolved = segments
            .into_iter()
            .filter_map(|segment| {
                let span = clip_to_range(&segment, range.from, range.to, now)?;
                let mut activity = classify(&segment, &rules);
                // A rule or assignment pointing at a deleted activity counts as unassigned.
                if activity != UNASSIGNED && !cats.iter().any(|c| c.id == activity) {
                    activity = UNASSIGNED;
                }
                Some(Resolved {
                    start: span.start,
                    end: span.end,
                    segment,
                    activity,
                })
            })
            .collect();
        Ok((resolved, cats))
    }
}

fn app_label(segment: &Segment) -> String {
    segment.app_name.clone().unwrap_or_default()
}

fn activity_label(id: ActivityId, cats: &[Activity]) -> (String, String) {
    cats.iter().find(|c| c.id == id).map_or_else(
        || (UNASSIGNED_NAME.to_owned(), UNASSIGNED_COLOR.to_owned()),
        |c| (c.name.clone(), c.color.clone()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fakes::{FakeActivities, FakeStore};
    use domain::{ActivityRule, Productivity, RuleKind};

    const MIN: i64 = 60_000;

    fn seg(
        start: i64,
        end: Option<i64>,
        app: Option<&str>,
        title: Option<&str>,
        manual: Option<i64>,
    ) -> Segment {
        Segment {
            id: SegmentId(0),
            started_at: UtcMs(start),
            ended_at: end.map(UtcMs),
            heartbeat_at: UtcMs(start),
            app_id: app.map(Into::into),
            app_name: app.map(|a| a.to_uppercase()),
            window_title: title.map(Into::into),
            end_reason: end.map(|_| EndReason::FocusChange),
            source: if app.is_some() {
                SegmentSource::Tracked
            } else {
                SegmentSource::IdleAssigned
            },
            activity_id: manual.map(ActivityId),
        }
    }

    fn range(from: i64, to: i64) -> Range {
        Range {
            from: UtcMs(from),
            to: UtcMs(to),
        }
    }

    /// Ids: 1 = Unassigned, 2 = Work, 3 = Chat.
    fn setup() -> (Queries, FakeStore, FakeActivities) {
        let store = FakeStore::default();
        let cats = FakeActivities::default();
        cats.create("Unassigned", "#999999", Productivity::Neutral)
            .unwrap();
        cats.create("Work", "#00ff00", Productivity::Neutral)
            .unwrap();
        cats.create("Chat", "#0000ff", Productivity::Neutral)
            .unwrap();
        let q = Queries::new(Arc::new(store.clone()), Arc::new(cats.clone()));
        (q, store, cats)
    }

    fn app_rule(id: i64, cat: i64, bundle: &str) -> ActivityRule {
        ActivityRule {
            id,
            activity_id: ActivityId(cat),
            kind: RuleKind::App(bundle.into()),
            priority: 0,
        }
    }

    #[test]
    fn totals_by_app_and_activity_use_rules_and_manual_assignment() {
        let (q, store, cats) = setup();
        cats.save_rule(&app_rule(1, 2, "code")).unwrap();
        cats.save_rule(&app_rule(2, 3, "slack")).unwrap();
        store.seed_segment(seg(0, Some(30 * MIN), Some("code"), None, None));
        store.seed_segment(seg(30 * MIN, Some(40 * MIN), Some("slack"), None, None));
        store.seed_segment(seg(40 * MIN, Some(50 * MIN), Some("misc"), None, None));
        // Idle time assigned to Work: no app, counted under an empty app name (the UI labels it).
        store.seed_segment(seg(50 * MIN, Some(60 * MIN), None, None, Some(2)));

        let r = q.range_report(range(0, 60 * MIN), &[], UtcMs(0)).unwrap();
        assert_eq!(r.total_ms, 60 * MIN);
        let apps: Vec<_> = r
            .by_app
            .iter()
            .map(|a| (a.app_name.as_str(), a.total_ms))
            .collect();
        assert_eq!(
            apps,
            vec![
                ("CODE", 30 * MIN),
                ("", 10 * MIN),
                ("MISC", 10 * MIN),
                ("SLACK", 10 * MIN),
            ]
        );
        let cat: Vec<_> = r
            .by_activity
            .iter()
            .map(|c| (c.name.as_str(), c.total_ms))
            .collect();
        assert_eq!(
            cat,
            vec![
                ("Work", 40 * MIN),
                ("Unassigned", 10 * MIN),
                ("Chat", 10 * MIN)
            ]
        );
    }

    #[test]
    fn rules_apply_to_existing_segments_without_rewriting_them() {
        let (q, store, cats) = setup();
        store.seed_segment(seg(0, Some(MIN), Some("code"), None, None));
        let r = q.range_report(range(0, MIN), &[], UtcMs(0)).unwrap();
        assert_eq!(r.by_activity[0].activity_id, UNASSIGNED);

        cats.save_rule(&app_rule(1, 2, "code")).unwrap();
        let r = q.range_report(range(0, MIN), &[], UtcMs(0)).unwrap();
        assert_eq!(r.by_activity[0].name, "Work");
        assert!(store.segments()[0].activity_id.is_none());
    }

    #[test]
    fn deleted_activity_falls_back_to_unassigned() {
        let (q, store, _) = setup();
        store.seed_segment(seg(0, Some(MIN), None, None, Some(99)));
        let r = q.range_report(range(0, MIN), &[], UtcMs(0)).unwrap();
        assert_eq!(r.by_activity[0].activity_id, UNASSIGNED);
    }

    #[test]
    fn segment_crossing_midnight_is_shared_between_day_buckets() {
        let (q, store, _) = setup();
        let day = 24 * 60 * MIN;
        store.seed_segment(seg(
            day - 10 * MIN,
            Some(day + 10 * MIN),
            Some("a"),
            None,
            None,
        ));
        let buckets = [range(0, day), range(day, 2 * day)];
        let r = q
            .range_report(range(0, 2 * day), &buckets, UtcMs(0))
            .unwrap();
        let b: Vec<i64> = r.by_bucket.iter().map(|b| b.total_ms).collect();
        assert_eq!(b, vec![10 * MIN, 10 * MIN]);
        assert_eq!(r.total_ms, 20 * MIN);
    }

    #[test]
    fn range_clips_edges_and_counts_open_segment_until_now() {
        let (q, store, _) = setup();
        store.seed_segment(seg(0, Some(100 * MIN), Some("a"), None, None));
        store.seed_segment(seg(100 * MIN, None, Some("b"), None, None));
        let r = q
            .range_report(range(50 * MIN, 130 * MIN), &[], UtcMs(120 * MIN))
            .unwrap();
        assert_eq!(r.total_ms, 50 * MIN + 20 * MIN);
    }

    #[test]
    fn empty_range_gives_empty_report_and_bad_range_is_rejected() {
        let (q, _, _) = setup();
        let r = q.range_report(range(0, MIN), &[], UtcMs(0)).unwrap();
        assert_eq!((r.total_ms, r.by_app.len(), r.by_activity.len()), (0, 0, 0));
        assert_eq!(
            q.range_report(range(MIN, MIN), &[], UtcMs(0)),
            Err(QueryError::InvalidRange)
        );
    }

    #[test]
    fn today_summary_keeps_total_but_truncates_top_apps() {
        let (q, store, _) = setup();
        store.seed_segment(seg(0, Some(30 * MIN), Some("a"), None, None));
        store.seed_segment(seg(30 * MIN, Some(40 * MIN), Some("b"), None, None));
        store.seed_segment(seg(40 * MIN, Some(45 * MIN), Some("c"), None, None));
        let r = q.today_summary(range(0, 60 * MIN), 2, UtcMs(0)).unwrap();
        assert_eq!(r.by_app.len(), 2);
        assert_eq!(r.total_ms, 45 * MIN);
        assert_eq!(r.by_bucket.len(), 1);
    }

    #[test]
    fn timeline_is_chronological_clipped_and_resolves_activity() {
        let (q, store, cats) = setup();
        cats.save_rule(&app_rule(1, 2, "a")).unwrap();
        store.seed_segment(seg(20 * MIN, Some(30 * MIN), Some("b"), None, None));
        store.seed_segment(seg(0, Some(15 * MIN), Some("a"), Some("t"), None));
        let items = q.timeline(range(5 * MIN, 25 * MIN), UtcMs(0)).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(
            (items[0].start, items[0].end),
            (UtcMs(5 * MIN), UtcMs(15 * MIN))
        );
        assert_eq!(items[0].activity_name, "Work");
        assert_eq!(items[0].end_reason, Some(EndReason::FocusChange));
        // Second span is cut by the range end: reason hidden, not open.
        assert_eq!(items[1].end, UtcMs(25 * MIN));
        assert_eq!(items[1].end_reason, None);
        assert!(!items[1].open);
    }

    #[test]
    fn title_detail_groups_by_app_and_title() {
        let (q, store, _) = setup();
        store.seed_segment(seg(0, Some(10 * MIN), Some("a"), Some("doc"), None));
        store.seed_segment(seg(10 * MIN, Some(15 * MIN), Some("b"), Some("doc"), None));
        store.seed_segment(seg(15 * MIN, Some(20 * MIN), Some("a"), Some("doc"), None));
        store.seed_segment(seg(20 * MIN, Some(21 * MIN), Some("a"), None, None));

        let all = q.title_detail(range(0, 60 * MIN), None, UtcMs(0)).unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!((all[0].total_ms, all[0].spans), (15 * MIN, 2));

        let only_a = q
            .title_detail(range(0, 60 * MIN), Some("a"), UtcMs(0))
            .unwrap();
        assert_eq!(only_a.len(), 2);
        assert!(only_a.iter().all(|t| t.app_id.as_deref() == Some("a")));
    }

    #[test]
    fn export_csv_neutralizes_titles_and_empty_range_is_header_only() {
        let (q, store, _) = setup();
        let empty = q.export_csv(range(0, MIN), UtcMs(0)).unwrap();
        assert_eq!(empty.lines().count(), 1);

        store.seed_segment(seg(0, Some(MIN), Some("a"), Some("=CMD()"), None));
        let csv = q.export_csv(range(0, MIN), UtcMs(0)).unwrap();
        assert_eq!(csv.lines().count(), 2);
        assert!(csv.contains(",'=CMD(),"));
    }
}
