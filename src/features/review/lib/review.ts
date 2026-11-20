import type {
  AiProviderDto,
  AiProviderInfoDto,
  AiReviewDto,
  AiSettingsDto,
  FocusSessionDto,
  GoalWeekDto,
  ReviewPreviewDto,
} from "@/shared/ipc";
import type { Messages } from "@/shared/i18n";
import { formatDuration } from "@/shared/lib/time";

/** Pure view-model helpers for the weekly review (no IPC, no clock). */

/** Furthest week the review (note and AI analysis) can go back; the backend refuses more. */
export const MAX_WEEKS_AGO = 104;

/** Longest personal note (the backend refuses more). */
export const MAX_NOTE_LENGTH = 4000;

/** `Mon`, `Tue`... for a local day number (days since 1970-01-01), in `locale`. */
export function dayName(day: number, locale?: string): string {
  return new Date(Date.UTC(1970, 0, 1 + day)).toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" });
}

/** One sentence on how a goal fared in the reviewed week. */
export function goalWeekLine(week: GoalWeekDto, t: Messages): string {
  const words = t.review.goalLine;
  const { goal, periods } = week;
  const counted = periods.filter((p) => p.result === "met" || p.result === "missed");
  if (goal.period === "daily") {
    if (counted.length === 0) return words.noDayEnded;
    return words.metOnDays(week.met, counted.length);
  }
  const only = periods[0];
  if (!only) return words.nothing;
  const target = formatDuration(goal.target_ms);
  const actual = formatDuration(only.actual_ms);
  switch (only.result) {
    case "met":
      return words.met(goal.period, actual, target);
    case "missed":
      return words.missed(goal.period, actual, target);
    case "in_progress":
      return words.inProgress(goal.period, actual, target);
    case "inactive":
      return words.inactive;
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

export function focusWeekLine(week: FocusWeek, t: Messages): string {
  const words = t.review.focusLine;
  if (week.count === 0) return words.none;
  const parts = [words.sessions(week.count, week.completed), words.planned(formatDuration(week.plannedMs))];
  if (week.averageInside !== null) parts.push(words.onTarget(week.averageInside));
  if (week.driftAlerts > 0) parts.push(words.nudges(week.driftAlerts));
  return `${parts.join(" · ")}.`;
}

export function bytesLabel(bytes: number, t: Messages): string {
  if (bytes < 1024) return t.review.request.bytes(bytes);
  return t.review.request.kilobytes((bytes / 1024).toFixed(1));
}

/** Plain words on where the data of a request goes. */
export function destinationText(
  preview: Pick<ReviewPreviewDto, "local" | "provider" | "model">,
  label: string,
  t: Messages,
): string {
  return preview.local
    ? t.review.request.destinationLocal(label, preview.model)
    : t.review.request.destinationRemote(label, preview.model);
}

export function titlesText(preview: Pick<ReviewPreviewDto, "included_titles" | "title_count">, t: Messages): string {
  if (!preview.included_titles) return t.review.request.noTitles;
  return preview.title_count === 0 ? t.review.request.titlesNoneRecorded : t.review.request.titles(preview.title_count);
}

/** Display name of a provider; the backend's label for anything this UI does not know. */
export function providerLabel(info: Pick<AiProviderInfoDto, "provider" | "label">, t: Messages): string {
  return (t.review.settings.providerLabels as Partial<Record<string, string>>)[info.provider] ?? info.label;
}

/**
 * The week of a saved analysis. The backend stores it as `2026-10-12 to 2026-10-18`; only the
 * joining word is translated, and any other shape is shown as it came.
 */
export function weekLabel(label: string, t: Messages): string {
  const match = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(label);
  return match?.[1] && match[2] ? t.review.weekRange(match[1], match[2]) : label;
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

export function reviewTitle(review: AiReviewDto, label: string, t: Messages, locale?: string): string {
  const when = new Date(review.created_at).toLocaleDateString(locale, { month: "short", day: "numeric" });
  return `${weekLabel(review.period_label, t)} · ${label} (${review.model}) · ${when}`;
}
