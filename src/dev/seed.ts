/**
 * Seed data for the mocked backend (dev and E2E only). Everything is anchored to `now` so the
 * dashboard always shows "today": the current day is walked backwards from `now`, earlier days
 * start at fixed local hours. Nothing here ships in production builds (see `mount.tsx`).
 */

import type { CategoryDto, FocusDto, IdleGapDto, RuleDto } from "@/shared/ipc";
import { addLocalDays } from "@/shared/lib/time";

const MINUTE = 60_000;

export interface MockSegment {
  id: number;
  started_at: number;
  /** `null` while open. */
  ended_at: number | null;
  app_id: string | null;
  app_name: string | null;
  window_title: string | null;
  source: "tracked" | "idle_assigned";
  category_id: number | null;
  end_reason: "focus_change" | "idle" | "pause" | "stop" | null;
}

export interface MockData {
  segments: MockSegment[];
  categories: CategoryDto[];
  rules: RuleDto[];
  gaps: IdleGapDto[];
  excluded: string[];
  redacted: string[];
  nextIds: { segment: number; category: number; rule: number; gap: number };
}

export const APPS = {
  xcode: { app_id: "com.apple.dt.Xcode", app_name: "Xcode" },
  slack: { app_id: "com.tinyspeck.slackmacgap", app_name: "Slack" },
  safari: { app_id: "com.apple.Safari", app_name: "Safari" },
  zoom: { app_id: "us.zoom.xos", app_name: "zoom.us" },
  notion: { app_id: "notion.id", app_name: "Notion" },
  mail: { app_id: "com.apple.mail", app_name: "Mail" },
} as const;

type AppKey = keyof typeof APPS;

export function seedCategories(): CategoryDto[] {
  return [
    // The migration seeds the system category with a Spanish name; the UI maps it by id.
    { id: 1, name: "Sin categoría", color: "#9ca3af", sort_order: 0 },
    { id: 2, name: "Development", color: "#3b82f6", sort_order: 1 },
    { id: 3, name: "Communication", color: "#22c55e", sort_order: 2 },
    { id: 4, name: "Meetings", color: "#f97316", sort_order: 3 },
    { id: 5, name: "Planning", color: "#a855f7", sort_order: 4 },
  ];
}

export function seedRules(): RuleDto[] {
  return [
    { id: 1, category_id: 2, spec: { kind: "app", app_id: APPS.xcode.app_id }, priority: 1 },
    { id: 2, category_id: 3, spec: { kind: "app", app_id: APPS.slack.app_id }, priority: 1 },
    { id: 3, category_id: 3, spec: { kind: "app", app_id: APPS.mail.app_id }, priority: 2 },
    { id: 4, category_id: 4, spec: { kind: "app", app_id: APPS.zoom.app_id }, priority: 3 },
    { id: 5, category_id: 5, spec: { kind: "title_pattern", pattern: "(?i)sprint|roadmap", app_id: null }, priority: 1 },
  ];
}

interface Step {
  app: AppKey;
  title: string;
  minutes: number;
}

/** Chronological script of today; the last step is the open segment. `null` is an idle hole. */
const TODAY: readonly (Step | { idleMinutes: number })[] = [
  { app: "slack", title: "#eng-standup", minutes: 15 },
  { app: "xcode", title: "TimeTrackApp.swift", minutes: 70 },
  { app: "safari", title: "Swift concurrency - Apple Developer Documentation", minutes: 20 },
  { app: "zoom", title: "Weekly sync", minutes: 30 },
  { app: "xcode", title: "Tracker.swift", minutes: 55 },
  { app: "slack", title: "Design review thread", minutes: 10 },
  { idleMinutes: 12 },
  { app: "notion", title: "Sprint plan", minutes: 25 },
  { app: "xcode", title: "AppDelegate.swift", minutes: 40 },
];

/** Deterministic pseudo random generator (mulberry32) so earlier days are always the same. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PAST_TITLES: Record<AppKey, string[]> = {
  xcode: ["TimeTrackApp.swift", "Tracker.swift", "Report.swift"],
  slack: ["#eng-standup", "#general", "Design review thread"],
  safari: ["Swift forums", "Tauri documentation", "Hacker News"],
  zoom: ["Weekly sync", "1:1"],
  notion: ["Sprint plan", "Roadmap Q4", "Meeting notes"],
  mail: ["Inbox"],
};
const PAST_APPS: AppKey[] = ["xcode", "xcode", "xcode", "slack", "safari", "zoom", "notion", "mail"];

export function buildSeed(now: number): MockData {
  const segments: MockSegment[] = [];
  const gaps: IdleGapDto[] = [];
  let nextSegment = 1;
  let nextGap = 1;

  // Earlier days (up to 45 back): a workday of focus blocks from 09:00, shorter on weekends.
  for (let back = 45; back >= 1; back--) {
    const dayStart = addLocalDays(now, -back);
    const date = new Date(dayStart);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const roll = random(dayStart / 86_400_000);
    let cursor = dayStart + (weekend ? 11 : 9) * 60 * MINUTE;
    const blocks = weekend ? 3 : 9 + Math.floor(roll() * 4);
    for (let i = 0; i < blocks; i++) {
      const key = PAST_APPS[Math.floor(roll() * PAST_APPS.length)] ?? "xcode";
      const titles = PAST_TITLES[key];
      const minutes = 10 + Math.floor(roll() * 50);
      const end = cursor + minutes * MINUTE;
      segments.push({
        id: nextSegment++,
        started_at: cursor,
        ended_at: end,
        ...APPS[key],
        window_title: titles[Math.floor(roll() * titles.length)] ?? null,
        source: "tracked",
        category_id: null,
        end_reason: "focus_change",
      });
      cursor = end + (i === Math.floor(blocks / 2) ? 45 * MINUTE : 0);
    }
  }

  // Today, walked backwards from `now`.
  const total = TODAY.reduce((sum, step) => sum + ("idleMinutes" in step ? step.idleMinutes : step.minutes), 0);
  let cursor = now - total * MINUTE;
  let previous: FocusDto | null = null;
  TODAY.forEach((step, index) => {
    if ("idleMinutes" in step) {
      const end = cursor + step.idleMinutes * MINUTE;
      gaps.push({
        id: nextGap++,
        started_at: cursor,
        ended_at: end,
        prev_focus: previous,
        expires_at: now + 10 * MINUTE,
      });
      cursor = end;
      return;
    }
    const last = index === TODAY.length - 1;
    const end = cursor + step.minutes * MINUTE;
    segments.push({
      id: nextSegment++,
      started_at: cursor,
      ended_at: last ? null : end,
      ...APPS[step.app],
      window_title: step.title,
      source: "tracked",
      category_id: null,
      end_reason: last ? null : "focus_change",
    });
    previous = { ...APPS[step.app], window_title: step.title };
    cursor = end;
  });

  return {
    segments,
    categories: seedCategories(),
    rules: seedRules(),
    gaps,
    excluded: [],
    redacted: [],
    nextIds: { segment: nextSegment, category: 6, rule: 6, gap: nextGap },
  };
}
