use crate::segment::Segment;
use crate::time::UtcMs;

/// A half-open span `[start, end)` of counted time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClippedSpan {
    pub start: UtcMs,
    pub end: UtcMs,
}

impl ClippedSpan {
    pub fn duration_ms(&self) -> i64 {
        self.end.since(self.start)
    }
}

/// Clips a segment to `[from, to)`; an open segment counts up to `now` (R7.2, R8.3).
/// Idle and discarded time is never a segment (an idle gap only becomes one when the
/// user assigns it), so only empty or out-of-range spans are dropped here.
pub fn clip_to_range(segment: &Segment, from: UtcMs, to: UtcMs, now: UtcMs) -> Option<ClippedSpan> {
    let start = segment.started_at.max(from);
    let end = segment.ended_at.unwrap_or(now).min(to);
    (end > start).then_some(ClippedSpan { start, end })
}

/// Splits a span at caller-provided boundaries (local midnights computed by the frontend,
/// DST included), so a segment crossing midnight is shared between days (R8.3).
pub fn split_at_boundaries(span: ClippedSpan, boundaries: &[UtcMs]) -> Vec<ClippedSpan> {
    let mut cuts: Vec<UtcMs> = boundaries
        .iter()
        .copied()
        .filter(|b| *b > span.start && *b < span.end)
        .collect();
    cuts.sort();
    cuts.dedup();
    let mut out = Vec::with_capacity(cuts.len() + 1);
    let mut start = span.start;
    for cut in cuts.into_iter().chain(std::iter::once(span.end)) {
        out.push(ClippedSpan { start, end: cut });
        start = cut;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::segment::{EndReason, SegmentId, SegmentSource};

    fn seg(start: i64, end: Option<i64>) -> Segment {
        Segment {
            id: SegmentId(1),
            started_at: UtcMs(start),
            ended_at: end.map(UtcMs),
            heartbeat_at: UtcMs(start),
            app_id: Some("a".into()),
            app_name: Some("A".into()),
            window_title: None,
            end_reason: end.map(|_| EndReason::Stop),
            source: SegmentSource::Tracked,
            category_id: None,
        }
    }

    #[test]
    fn clips_both_edges() {
        let c = clip_to_range(&seg(0, Some(100)), UtcMs(20), UtcMs(70), UtcMs(0)).unwrap();
        assert_eq!(
            (c.start, c.end, c.duration_ms()),
            (UtcMs(20), UtcMs(70), 50)
        );
    }

    #[test]
    fn outside_or_empty_is_dropped() {
        assert!(clip_to_range(&seg(0, Some(10)), UtcMs(10), UtcMs(20), UtcMs(0)).is_none());
        assert!(clip_to_range(&seg(30, Some(40)), UtcMs(10), UtcMs(20), UtcMs(0)).is_none());
        assert!(clip_to_range(&seg(5, Some(5)), UtcMs(0), UtcMs(20), UtcMs(0)).is_none());
    }

    #[test]
    fn open_segment_counts_until_now() {
        let c = clip_to_range(&seg(10, None), UtcMs(0), UtcMs(1_000), UtcMs(60)).unwrap();
        assert_eq!(c.duration_ms(), 50);
    }

    #[test]
    fn midnight_crossing_is_split_evenly() {
        // 23:50 -> 00:10 around a midnight at t = 600_000 ms.
        let span = ClippedSpan {
            start: UtcMs(0),
            end: UtcMs(1_200_000),
        };
        let parts = split_at_boundaries(span, &[UtcMs(600_000)]);
        let d: Vec<i64> = parts.iter().map(ClippedSpan::duration_ms).collect();
        assert_eq!(d, vec![600_000, 600_000]);
    }

    #[test]
    fn boundaries_outside_span_or_duplicated_are_ignored() {
        let span = ClippedSpan {
            start: UtcMs(10),
            end: UtcMs(20),
        };
        assert_eq!(
            split_at_boundaries(span, &[UtcMs(10), UtcMs(20), UtcMs(5), UtcMs(99)]),
            vec![span]
        );
        let parts = split_at_boundaries(span, &[UtcMs(15), UtcMs(15)]);
        assert_eq!(parts.len(), 2);
    }
}
