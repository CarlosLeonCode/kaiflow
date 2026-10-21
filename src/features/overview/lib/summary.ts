import type { Bar, BarSegment } from "@/shared/charts/types";
import type { TrendPoint } from "@/shared/charts/TrendLine";
import type {
  AppTotalDto,
  DashboardActivityDto,
  DashboardDto,
  TitleTotalDto,
  TrendDto,
} from "@/shared/ipc";
import { activityLabel, appLabel, NO_TITLE_LABEL } from "@/shared/lib/labels";
import { formatDuration, formatHour, formatTimeOfDay } from "@/shared/lib/time";

import { bucketNoun, previousLabel, type Period } from "./periods";

/** Pure view-model helpers for the Overview (no IPC, no clock). */

/** What the trend line under the total says. Direction is always spelled out, never only colored. */
export interface TrendView {
  direction: "up" | "down" | "same" | "none";
  text: string;
}

export function trendView(period: Period, trend: TrendDto): TrendView {
  const against = previousLabel(period);
  if (trend.kind === "no_comparison") {
    return { direction: "none", text: `No comparison: nothing was tracked in ${against}` };
  }
  if (trend.delta_ms === 0) return { direction: "same", text: `Same as ${against}` };
  const amount = formatDuration(Math.abs(trend.delta_ms));
  const more = trend.delta_ms > 0;
  const sign = trend.pct > 0 ? "+" : "";
  return {
    direction: more ? "up" : "down",
    text: `${amount} ${more ? "more" : "less"} than ${against} (${sign}${trend.pct}%)`,
  };
}

function axisLabel(period: Period, from: number): string {
  const date = new Date(from);
  switch (period) {
    case "day":
      return formatHour(from);
    case "week":
      return date.toLocaleDateString(undefined, { weekday: "short" });
    case "month":
      return String(date.getDate());
    case "last90":
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
}

function fullLabel(period: Period, from: number, to: number): string {
  const date = new Date(from);
  switch (period) {
    case "day":
      return formatTimeOfDay(from);
    case "last90": {
      const format = { month: "short", day: "numeric" } as const;
      return `Week of ${new Intl.DateTimeFormat(undefined, format).formatRange(from, Math.max(from, to - 1))}`;
    }
    default:
      return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  }
}

/** The activity listing of a dashboard by id, for naming and coloring bucket segments. */
function activitiesById(dashboard: DashboardDto): Map<number, DashboardActivityDto> {
  return new Map(dashboard.by_activity.map((activity) => [activity.activity_id, activity]));
}

/**
 * Bars of the stacked chart: one per bucket (hour, day or week), each split by activity with
 * the biggest slice first. The backend already did the splitting; this only names and colors.
 */
export function bucketBars(period: Period, dashboard: DashboardDto): Bar[] {
  const activities = activitiesById(dashboard);
  return dashboard.buckets.map((bucket) => {
    const segments: BarSegment[] = bucket.by_activity
      .filter((slice) => slice.total_ms > 0)
      .map((slice) => {
        const activity = activities.get(slice.activity_id);
        return {
          key: `activity-${slice.activity_id}`,
          name: activityLabel(slice.activity_id, activity?.name ?? ""),
          color: activity?.color ?? "#9ca3af",
          ms: slice.total_ms,
        };
      });
    return {
      range: bucket.range,
      label: axisLabel(period, bucket.range.from),
      fullLabel: fullLabel(period, bucket.range.from, bucket.range.to),
      totalMs: bucket.total_ms,
      segments,
    };
  });
}

/** Points of the trend line, one per bar. */
export function trendPoints(bars: readonly Bar[]): TrendPoint[] {
  return bars.map((bar) => ({
    key: bar.range.from,
    label: bar.fullLabel,
    axis: bar.label,
    totalMs: bar.totalMs,
  }));
}

export interface Averages {
  /** Mean over the buckets that actually have tracked time. */
  perActiveBucketMs: number;
  activeBuckets: number;
}

export function averages(bars: readonly Bar[]): Averages {
  const active = bars.filter((bar) => bar.totalMs > 0);
  const sum = active.reduce((acc, bar) => acc + bar.totalMs, 0);
  return { perActiveBucketMs: active.length > 0 ? Math.round(sum / active.length) : 0, activeBuckets: active.length };
}

export function busiest(bars: readonly Bar[]): Bar | null {
  let best: Bar | null = null;
  for (const bar of bars) if (bar.totalMs > 0 && (!best || bar.totalMs > best.totalMs)) best = bar;
  return best;
}

/** Singular and plural nouns for the bucket of a period (`hour`, `day`, `week`). */
export function bucketWords(period: Period): { singular: string; plural: string } {
  const singular = bucketNoun(period);
  return { singular, plural: `${singular}s` };
}

export interface Row {
  key: string;
  name: string;
  /** Secondary text: the app of a window title. */
  detail?: string;
  color?: string;
  totalMs: number;
  /** 0..1 of the period total. */
  fraction: number;
}

export function appRows(byApp: readonly AppTotalDto[], totalMs: number): Row[] {
  return [...byApp]
    .sort((a, b) => b.total_ms - a.total_ms)
    .map((app) => ({
      key: app.app_id ?? "manual",
      name: appLabel(app.app_id, app.app_name),
      totalMs: app.total_ms,
      fraction: totalMs > 0 ? app.total_ms / totalMs : 0,
    }));
}

export function activityRows(byActivity: readonly DashboardActivityDto[], totalMs: number): Row[] {
  return [...byActivity]
    .sort((a, b) => b.total_ms - a.total_ms)
    .map((c) => ({
      key: String(c.activity_id),
      name: activityLabel(c.activity_id, c.name),
      color: c.color,
      totalMs: c.total_ms,
      fraction: totalMs > 0 ? c.total_ms / totalMs : 0,
    }));
}

export function titleRows(titles: readonly TitleTotalDto[], totalMs: number): Row[] {
  return titles.map((title, index) => ({
    key: `${index}-${title.app_id ?? "manual"}-${title.window_title ?? ""}`,
    name: title.window_title ?? NO_TITLE_LABEL,
    detail: appLabel(title.app_id, title.app_name),
    totalMs: title.total_ms,
    fraction: totalMs > 0 ? title.total_ms / totalMs : 0,
  }));
}
