import type { RestorePreviewDto } from "@/shared/ipc";
import { addLocalDays, formatTimeOfDay } from "@/shared/lib/time";

const dayFormat = { year: "numeric", month: "short", day: "numeric" } as const;

/** `Today at 9:12 AM`, `Yesterday at 9:12 AM`, `Oct 3, 2026 at 9:12 AM`, or `Never`. */
export function lastBackupLabel(at: number | null, now: number, locale?: string): string {
  if (at === null) return "Never";
  const time = formatTimeOfDay(at, locale);
  const startOfToday = addLocalDays(now, 0);
  if (at >= startOfToday) return `Today at ${time}`;
  if (at >= addLocalDays(now, -1)) return `Yesterday at ${time}`;
  return `${new Date(at).toLocaleDateString(locale, dayFormat)} at ${time}`;
}

function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
}

/** The first and last day of the tracked time in a file, or `null` when it has none. */
export function previewSpan(preview: RestorePreviewDto, locale?: string): string | null {
  if (preview.first_at === null || preview.last_at === null) return null;
  const first = new Date(preview.first_at).toLocaleDateString(locale, dayFormat);
  const last = new Date(preview.last_at).toLocaleDateString(locale, dayFormat);
  return first === last ? first : `${first} to ${last}`;
}

/** Plain-language confirmation text: what the file holds and what the restore replaces. */
export function restoreParagraphs(preview: RestorePreviewDto, locale?: string): string[] {
  const span = previewSpan(preview, locale);
  const contents = [
    count(preview.segments, "tracked segment"),
    count(preview.activities, "activity", "activities"),
    count(preview.rules, "rule"),
  ].join(", ");
  const paragraphs = [
    `${preview.file_name} holds ${contents}${span ? `, recorded ${span}` : ""}.`,
    "Restoring replaces everything stored now: tracked time, activities, rules and settings. A safety copy of your current data is saved first, next to the database.",
  ];
  if (preview.kind === "export") {
    paragraphs.splice(1, 0, "This file is an export of a date range, so only that range will remain after restoring.");
  }
  return paragraphs;
}
