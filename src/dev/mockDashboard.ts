/**
 * The dashboard the Rust backend computes in `application::dashboard`, for the mocked backend:
 * one pass over the clipped segments, local weekday/hour heatmap, stacked buckets, trend and
 * focus ratio. Kept apart from `mockBackend.ts` so the handler table stays readable.
 */

import type { ActivityDto, DashboardDto, RangeDto } from "@/shared/ipc";

import type { MockSegment } from "./seed";

const UNASSIGNED = 1;
const TOP_TITLES = 10;
const TOP_APPS = 50;

interface Input {
  range: RangeDto;
  buckets: RangeDto[];
  previous: RangeDto | null;
  segments: readonly MockSegment[];
  activities: readonly ActivityDto[];
  /** Activity id of a segment (manual assignment, rules). */
  classify: (segment: MockSegment) => number;
  /** Window title as the user's privacy settings keep it. */
  title: (segment: MockSegment) => string | null;
  now: number;
}

function clipTo(segment: MockSegment, range: RangeDto, now: number): { start: number; end: number } | null {
  const start = Math.max(segment.started_at, range.from);
  const end = Math.min(segment.ended_at ?? now, range.to);
  return end > start ? { start, end } : null;
}

/** Adds `[start, end)` to the weekday (Monday = 0) and local hour it falls in, hour by hour. */
function addToHeatmap(heatmap: number[], start: number, end: number): void {
  let cursor = start;
  while (cursor < end) {
    const date = new Date(cursor);
    const next = Math.max(cursor + 1, new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours() + 1).getTime());
    const pieceEnd = Math.min(next, end);
    const weekday = (date.getDay() + 6) % 7;
    heatmap[weekday * 24 + date.getHours()] = (heatmap[weekday * 24 + date.getHours()] ?? 0) + (pieceEnd - cursor);
    cursor = pieceEnd;
  }
}

export function buildDashboard(input: Input): DashboardDto {
  const { range, buckets, previous, now } = input;
  const byActivity = new Map<number, number>();
  const byApp = new Map<string, { app_id: string | null; app_name: string; total_ms: number }>();
  const byTitle = new Map<string, { app_id: string | null; app_name: string | null; window_title: string; total_ms: number }>();
  const bucketTotals = buckets.map(() => new Map<number, number>());
  const heatmap = Array.from({ length: 7 * 24 }, () => 0);
  let total = 0;
  let previousTotal = 0;

  for (const segment of input.segments) {
    if (previous) {
      const span = clipTo(segment, previous, now);
      if (span) previousTotal += span.end - span.start;
    }
    const span = clipTo(segment, range, now);
    if (!span) continue;
    const ms = span.end - span.start;
    total += ms;

    const known = input.activities.some((a) => a.id === input.classify(segment));
    const activity = known ? input.classify(segment) : UNASSIGNED;
    byActivity.set(activity, (byActivity.get(activity) ?? 0) + ms);

    const appKey = segment.app_id ?? "";
    const app = byApp.get(appKey) ?? { app_id: segment.app_id, app_name: segment.app_name ?? "", total_ms: 0 };
    app.total_ms += ms;
    byApp.set(appKey, app);

    const title = input.title(segment);
    if (title) {
      const key = `${appKey}\u0000${title}`;
      const row = byTitle.get(key) ?? { app_id: segment.app_id, app_name: segment.app_name, window_title: title, total_ms: 0 };
      row.total_ms += ms;
      byTitle.set(key, row);
    }

    buckets.forEach((bucket, index) => {
      const overlap = Math.min(span.end, bucket.to) - Math.max(span.start, bucket.from);
      if (overlap > 0) {
        const totals = bucketTotals[index];
        totals?.set(activity, (totals.get(activity) ?? 0) + overlap);
      }
    });
    addToHeatmap(heatmap, span.start, span.end);
  }

  const productivity = { productive_ms: 0, neutral_ms: 0, distracting_ms: 0 };
  const activityRows = [...byActivity.entries()]
    .map(([id, total_ms]) => {
      const activity = input.activities.find((a) => a.id === id) ?? input.activities[0];
      const kind = activity?.productivity ?? "neutral";
      productivity[`${kind}_ms`] += total_ms;
      return {
        activity_id: id,
        name: activity?.name ?? "Unassigned",
        color: activity?.color ?? "#9ca3af",
        productivity: kind,
        total_ms,
      };
    })
    .sort((a, b) => b.total_ms - a.total_ms || a.activity_id - b.activity_id);

  const signal = productivity.productive_ms + productivity.distracting_ms;
  const delta = total - previousTotal;
  return {
    range,
    total_ms: total,
    previous_total_ms: previousTotal,
    trend:
      previousTotal > 0
        ? { kind: "change", delta_ms: delta, pct: Math.round((delta / previousTotal) * 100) }
        : { kind: "no_comparison" },
    by_activity: activityRows,
    by_app: [...byApp.values()].sort((a, b) => b.total_ms - a.total_ms).slice(0, TOP_APPS),
    top_titles: [...byTitle.values()].sort((a, b) => b.total_ms - a.total_ms).slice(0, TOP_TITLES),
    buckets: buckets.map((bucket, index) => {
      const slices = [...(bucketTotals[index]?.entries() ?? [])]
        .map(([activity_id, total_ms]) => ({ activity_id, total_ms }))
        .sort((a, b) => b.total_ms - a.total_ms || a.activity_id - b.activity_id);
      return { range: bucket, total_ms: slices.reduce((sum, s) => sum + s.total_ms, 0), by_activity: slices };
    }),
    heatmap,
    productivity,
    focus_ratio: signal > 0 ? { kind: "ratio", ratio: productivity.productive_ms / signal } : { kind: "no_signal" },
    auto_discarded_gaps: 0,
    // Filled in by the mocked `get_dashboard` handler (it owns the goals).
    goals: [],
  };
}
