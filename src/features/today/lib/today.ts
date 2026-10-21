import type { AppTotalDto, ActivityTotalDto, RangeDto, TimelineItemDto } from "@/shared/ipc";
import { appLabel, activityLabel } from "@/shared/lib/labels";
import { HOUR } from "@/shared/lib/time";

/** Pure view-model helpers for the Today dashboard (no IPC, no clock of their own). */

/** Key used for time assigned manually to an activity (no app). */
export const MANUAL_KEY = "manual";

export function appKey(appId: string | null): string {
  return appId ?? MANUAL_KEY;
}

/** The open segment keeps growing: its end is at least `now`. */
function effectiveEnd(item: TimelineItemDto, now: number): number {
  return item.open ? Math.max(item.end, now) : item.end;
}

/** The part of an item inside `range`, as `[start, end]`, or `null` when nothing is left. */
export function clampItem(
  item: TimelineItemDto,
  range: RangeDto,
  now: number,
): { start: number; end: number } | null {
  const start = Math.max(item.start, range.from);
  const end = Math.min(effectiveEnd(item, now), range.to);
  return end > start ? { start, end } : null;
}

function floorHour(ms: number): number {
  const date = new Date(ms);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

function ceilHour(ms: number): number {
  const floor = floorHour(ms);
  return floor === ms ? ms : floor + HOUR;
}

const MIN_WINDOW = 4 * HOUR;

/**
 * Visible part of the day: from the hour of the first block to the hour after the last one
 * (or now), never shorter than 4 hours and always inside the day. Showing the whole 24 h
 * would squeeze a normal morning into a sliver.
 */
export function timelineWindow(items: readonly TimelineItemDto[], range: RangeDto, now: number): RangeDto {
  const spans = items.map((item) => clampItem(item, range, now)).filter((s) => s !== null);
  if (spans.length === 0) {
    const to = Math.min(range.to, ceilHour(Math.max(now, range.from + 1)) + HOUR);
    return { from: Math.max(range.from, to - MIN_WINDOW), to };
  }
  let from = floorHour(Math.min(...spans.map((s) => s.start)));
  let to = ceilHour(Math.max(...spans.map((s) => s.end), Math.min(now, range.to)));
  from = Math.max(from, range.from);
  to = Math.min(to, range.to);
  if (to - from < MIN_WINDOW) {
    to = Math.min(range.to, from + MIN_WINDOW);
    from = Math.max(range.from, to - MIN_WINDOW);
  }
  return { from, to };
}

export interface TimelineBlock {
  id: number;
  /** 0..100 of the window. */
  leftPct: number;
  widthPct: number;
  activityId: number;
  color: string;
  label: string;
  durationMs: number;
}

/** Positions every visible item inside the window. */
export function layoutTimeline(
  items: readonly TimelineItemDto[],
  window: RangeDto,
  now: number,
): TimelineBlock[] {
  const span = window.to - window.from;
  if (span <= 0) return [];
  const blocks: TimelineBlock[] = [];
  for (const item of items) {
    const clamped = clampItem(item, window, now);
    if (!clamped) continue;
    blocks.push({
      id: item.segment_id,
      leftPct: ((clamped.start - window.from) / span) * 100,
      widthPct: ((clamped.end - clamped.start) / span) * 100,
      activityId: item.activity_id,
      color: item.activity_color,
      label: blockLabel(item),
      durationMs: clamped.end - clamped.start,
    });
  }
  return blocks;
}

function blockLabel(item: TimelineItemDto): string {
  const app = appLabel(item.app_id, item.app_name);
  return `${app}, ${activityLabel(item.activity_id, item.activity_name)}`;
}

export interface AxisTick {
  at: number;
  /** 0..100 of the window. */
  pct: number;
}

/** Whole-hour ticks: every hour on short windows, every 2 or 3 hours on long ones. */
export function axisTicks(window: RangeDto): AxisTick[] {
  const span = window.to - window.from;
  if (span <= 0) return [];
  const hours = span / HOUR;
  const step = hours <= 6 ? 1 : hours <= 14 ? 2 : 3;
  const ticks: AxisTick[] = [];
  const cursor = new Date(ceilHour(window.from));
  while (cursor.getTime() <= window.to) {
    const at = cursor.getTime();
    ticks.push({ at, pct: ((at - window.from) / span) * 100 });
    cursor.setHours(cursor.getHours() + step, 0, 0, 0);
  }
  return ticks;
}

export interface TitleRow {
  /** `null` groups the time without a recorded title. */
  title: string | null;
  totalMs: number;
}

/** Time per exact window title for each app, longest first. */
export function titleBreakdown(
  items: readonly TimelineItemDto[],
  range: RangeDto,
  now: number,
): Map<string, TitleRow[]> {
  const perApp = new Map<string, Map<string | null, number>>();
  for (const item of items) {
    const clamped = clampItem(item, range, now);
    if (!clamped) continue;
    const key = appKey(item.app_id);
    const titles = perApp.get(key) ?? new Map<string | null, number>();
    titles.set(item.window_title, (titles.get(item.window_title) ?? 0) + (clamped.end - clamped.start));
    perApp.set(key, titles);
  }
  const result = new Map<string, TitleRow[]>();
  for (const [key, titles] of perApp) {
    result.set(
      key,
      [...titles.entries()]
        .map(([title, totalMs]) => ({ title, totalMs }))
        .sort((a, b) => b.totalMs - a.totalMs),
    );
  }
  return result;
}

/** Time spent away: gaps that follow a segment closed because the user went idle. */
export function awayMs(items: readonly TimelineItemDto[], range: RangeDto, now: number): number {
  const ordered = [...items].sort((a, b) => a.start - b.start);
  let away = 0;
  ordered.forEach((item, index) => {
    if (item.open || item.end_reason !== "idle") return;
    const next = ordered[index + 1];
    const until = next ? next.start : Math.min(now, range.to);
    away += Math.max(0, until - item.end);
  });
  return away;
}

export interface AppRow {
  key: string;
  name: string;
  totalMs: number;
  /** 0..1 relative to the largest row. */
  share: number;
  titles: TitleRow[];
}

/** By-app rows with the live delta added to the app of the open segment. */
export function buildAppRows(
  byApp: readonly AppTotalDto[],
  open: TimelineItemDto | undefined,
  elapsedMs: number,
  titles: ReadonlyMap<string, TitleRow[]>,
): AppRow[] {
  const rows = byApp.map((app) => ({
    key: appKey(app.app_id),
    name: appLabel(app.app_id, app.app_name),
    totalMs: app.total_ms,
  }));
  if (open && elapsedMs > 0) {
    const key = appKey(open.app_id);
    const live = rows.find((row) => row.key === key);
    if (live) live.totalMs += elapsedMs;
    else rows.push({ key, name: appLabel(open.app_id, open.app_name), totalMs: elapsedMs });
  }
  rows.sort((a, b) => b.totalMs - a.totalMs);
  const max = rows[0]?.totalMs ?? 0;
  return rows.map((row) => ({
    ...row,
    share: max > 0 ? row.totalMs / max : 0,
    titles: titles.get(row.key) ?? [],
  }));
}

export interface ActivityRow {
  id: number;
  name: string;
  color: string;
  totalMs: number;
  /** 0..1 of the day's tracked total. */
  fraction: number;
}

export function buildActivityRows(
  byActivity: readonly ActivityTotalDto[],
  open: TimelineItemDto | undefined,
  elapsedMs: number,
  totalMs: number,
): ActivityRow[] {
  const rows = byActivity.map((c) => ({
    id: c.activity_id,
    name: activityLabel(c.activity_id, c.name),
    color: c.color,
    totalMs: c.total_ms,
  }));
  if (open && elapsedMs > 0) {
    const live = rows.find((row) => row.id === open.activity_id);
    if (live) live.totalMs += elapsedMs;
    else
      rows.push({
        id: open.activity_id,
        name: activityLabel(open.activity_id, open.activity_name),
        color: open.activity_color,
        totalMs: elapsedMs,
      });
  }
  rows.sort((a, b) => b.totalMs - a.totalMs);
  return rows.map((row) => ({ ...row, fraction: totalMs > 0 ? row.totalMs / totalMs : 0 }));
}

/** Whole-number percent for display; `<1%` instead of a misleading `0%`. */
export function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}
