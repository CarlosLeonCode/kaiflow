import type { AppTotalDto, ActivityTotalDto, RangeDto, ReportDto } from "@/shared/ipc";
import { appLabel, activityLabel } from "@/shared/lib/labels";
import { formatHour, formatTimeOfDay, MINUTE } from "@/shared/lib/time";

import type { Period } from "./periods";

/** Pure view-model helpers for History (no IPC, no clock). */

export interface Comparison {
  deltaMs: number;
  /** Relative change, or `null` when the previous period had no time (nothing to compare). */
  pct: number | null;
  direction: "up" | "down" | "same";
}

export function compareTotals(current: number, previous: number): Comparison {
  const deltaMs = current - previous;
  return {
    deltaMs,
    pct: previous > 0 ? Math.round((deltaMs / previous) * 100) : null,
    direction: deltaMs === 0 ? "same" : deltaMs > 0 ? "up" : "down",
  };
}

export interface BarSegment {
  key: string;
  name: string;
  color: string;
  ms: number;
}

export interface Bar {
  range: RangeDto;
  /** Short axis label (`Mon`, `20`, `9 AM`). */
  label: string;
  /** Long accessible name (`Monday, October 19`). */
  fullLabel: string;
  totalMs: number;
  segments: BarSegment[];
}

/** Color of the single-segment bars (hours inside one day are not split by activity). */
export const FOCUS_COLOR = "#3b82f6";

function axisLabel(period: Period, from: number): string {
  const date = new Date(from);
  switch (period) {
    case "day":
      return formatHour(from);
    case "week":
      return date.toLocaleDateString(undefined, { weekday: "short" });
    case "month":
      return String(date.getDate());
  }
}

function fullLabel(period: Period, from: number): string {
  const date = new Date(from);
  return period === "day"
    ? formatTimeOfDay(from)
    : date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/** Segments of one day, biggest first, each activity once. */
function activitySegments(report: ReportDto): BarSegment[] {
  return [...report.by_activity]
    .filter((activity) => activity.total_ms > 0)
    .sort((a, b) => b.total_ms - a.total_ms)
    .map((activity) => ({
      key: `activity-${activity.activity_id}`,
      name: activityLabel(activity.activity_id, activity.name),
      color: activity.color,
      ms: activity.total_ms,
    }));
}

/**
 * Bars for week and month: one per local day, stacked by activity. A day whose report has
 * not arrived yet is an empty bar (the chart never blocks on the slowest day).
 */
export function dayBars(
  period: Exclude<Period, "day">,
  days: readonly RangeDto[],
  reports: readonly (ReportDto | undefined)[],
): Bar[] {
  return days.map((range, index) => {
    const report = reports[index];
    return {
      range,
      label: axisLabel(period, range.from),
      fullLabel: fullLabel(period, range.from),
      totalMs: report?.total_ms ?? 0,
      segments: report ? activitySegments(report) : [],
    };
  });
}

/** Bars for the day view: hourly totals from the period report's buckets, one color. */
export function hourBars(report: ReportDto | undefined, hours: readonly RangeDto[]): Bar[] {
  return hours.map((range) => {
    const total = report?.by_bucket.find((bucket) => bucket.range.from === range.from)?.total_ms ?? 0;
    return {
      range,
      label: axisLabel("day", range.from),
      fullLabel: fullLabel("day", range.from),
      totalMs: total,
      segments: total > 0 ? [{ key: "focus", name: "Focused", color: FOCUS_COLOR, ms: total }] : [],
    };
  });
}

const CEILING_STEPS = [5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 600, 720, 960, 1440].map((m) => m * MINUTE);

/** Smallest "round" chart ceiling (5 min .. 24 h) that fits `maxMs`. */
export function niceCeiling(maxMs: number): number {
  if (maxMs <= 0) return 60 * MINUTE;
  return CEILING_STEPS.find((step) => step >= maxMs) ?? Math.ceil(maxMs / (60 * MINUTE)) * 60 * MINUTE;
}

export interface Averages {
  /** Mean over the days that actually have tracked time. */
  perActiveDayMs: number;
  activeDays: number;
}

export function averages(bars: readonly Bar[]): Averages {
  const active = bars.filter((bar) => bar.totalMs > 0);
  const sum = active.reduce((acc, bar) => acc + bar.totalMs, 0);
  return { perActiveDayMs: active.length > 0 ? Math.round(sum / active.length) : 0, activeDays: active.length };
}

export function busiest(bars: readonly Bar[]): Bar | null {
  let best: Bar | null = null;
  for (const bar of bars) if (bar.totalMs > 0 && (!best || bar.totalMs > best.totalMs)) best = bar;
  return best;
}

export interface Row {
  key: string;
  name: string;
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

export function activityRows(byActivity: readonly ActivityTotalDto[], totalMs: number): Row[] {
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
