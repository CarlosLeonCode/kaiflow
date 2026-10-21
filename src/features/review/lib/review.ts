import type {
  AiProviderDto,
  AiProviderInfoDto,
  AiReviewDto,
  AiSettingsDto,
  FocusSessionDto,
  GoalWeekDto,
  ReviewPreviewDto,
  WeekResultDto,
  WeeklyReviewDto,
} from "@/shared/ipc";
import { formatDuration } from "@/shared/lib/time";

/** Pure view-model helpers for the weekly review (no IPC, no clock). */

/** Furthest week the review can go back (the backend refuses more). */
export const MAX_WEEKS_AGO = 104;

/** Longest personal note (the backend refuses more). */
export const MAX_NOTE_LENGTH = 4000;

export function weekHeading(weeksAgo: number): string {
  if (weeksAgo === 0) return "This week";
  if (weeksAgo === 1) return "Last week";
  return `${weeksAgo} weeks ago`;
}

/** A week is empty when nothing was tracked and no focus session ran. */
export function isEmptyWeek(review: Pick<WeeklyReviewDto, "dashboard" | "focus">): boolean {
  return review.dashboard.total_ms === 0 && review.focus.length === 0;
}

/** `Mon`, `Tue`... for a local day number (days since 1970-01-01). */
export function dayName(day: number): string {
  return new Date(Date.UTC(1970, 0, 1 + day)).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
}

export const RESULT_LABEL: Record<WeekResultDto, string> = {
  met: "Met",
  missed: "Missed",
  inactive: "Rest day",
  in_progress: "In progress",
};

/** One sentence on how a goal fared in the reviewed week. */
export function goalWeekLine(week: GoalWeekDto): string {
  const { goal, periods } = week;
  const counted = periods.filter((p) => p.result === "met" || p.result === "missed");
  if (goal.period === "daily") {
    if (counted.length === 0) return "No active day has ended yet.";
    return `Met on ${week.met} of ${counted.length} active ${counted.length === 1 ? "day" : "days"}.`;
  }
  const only = periods[0];
  if (!only) return "Nothing to report.";
  const target = formatDuration(goal.target_ms);
  const actual = formatDuration(only.actual_ms);
  const scope = goal.period === "weekly" ? "week" : "month";
  switch (only.result) {
    case "met":
      return `Met this ${scope}: ${actual} of ${target}.`;
    case "missed":
      return `Missed this ${scope}: ${actual} of ${target}.`;
    case "in_progress":
      return `In progress this ${scope}: ${actual} of ${target} so far.`;
    case "inactive":
      return "Not active in this period.";
  }
}

export interface FocusWeek {
  count: number;
  completed: number;
  plannedMs: number;
  driftAlerts: number;
  /** Average share of tracked time that stayed on target; `null` without data. */
  averageInside: number | null;
}

export function focusWeek(sessions: readonly FocusSessionDto[]): FocusWeek {
  const percents = sessions.map((s) => s.percent_inside).filter((p): p is number => p !== null);
  return {
    count: sessions.length,
    completed: sessions.filter((s) => s.end_reason === "completed").length,
    plannedMs: sessions.reduce((sum, s) => sum + (s.planned_end - s.started_at), 0),
    driftAlerts: sessions.reduce((sum, s) => sum + s.drift_alerts, 0),
    averageInside: percents.length > 0 ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : null,
  };
}

export function focusWeekLine(week: FocusWeek): string {
  if (week.count === 0) return "No focus sessions this week.";
  const parts = [
    `${week.count} ${week.count === 1 ? "session" : "sessions"} (${week.completed} completed)`,
    `${formatDuration(week.plannedMs)} planned`,
  ];
  if (week.averageInside !== null) parts.push(`${week.averageInside}% on target`);
  if (week.driftAlerts > 0) parts.push(`${week.driftAlerts} ${week.driftAlerts === 1 ? "nudge" : "nudges"}`);
  return `${parts.join(" · ")}.`;
}

export function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Plain words on where the data of a request goes. */
export function destinationText(preview: Pick<ReviewPreviewDto, "local" | "provider" | "model">, label: string): string {
  return preview.local
    ? `Handled by ${label} on this computer (model ${preview.model}). Nothing leaves it.`
    : `Sent over the internet to ${label} (model ${preview.model}).`;
}

export function titlesText(preview: Pick<ReviewPreviewDto, "included_titles" | "title_count">): string {
  if (!preview.included_titles) return "Window titles are not included.";
  return preview.title_count === 0
    ? "Window titles are included, but none were recorded this week."
    : `Includes ${preview.title_count} window ${preview.title_count === 1 ? "title" : "titles"}, shortened to 80 characters.`;
}

export function providerInfo(settings: AiSettingsDto, provider: AiProviderDto): AiProviderInfoDto | undefined {
  return settings.providers.find((p) => p.provider === provider);
}

/** The provider the review panel would use, when it is switched on. */
export function activeProvider(settings: AiSettingsDto | undefined): AiProviderInfoDto | null {
  if (!settings) return null;
  const info = providerInfo(settings, settings.selected);
  return info?.enabled ? info : null;
}

/** What blocks a run besides the opt-in: a missing key. */
export function missingKey(info: AiProviderInfoDto): boolean {
  return info.needs_key && !info.has_key;
}

export function reviewTitle(review: AiReviewDto, label: string): string {
  const when = new Date(review.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${review.period_label} · ${label} (${review.model}) · ${when}`;
}
