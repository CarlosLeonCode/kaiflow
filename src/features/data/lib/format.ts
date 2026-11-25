import type { Messages } from "@/shared/i18n";
import type { RestorePreviewDto } from "@/shared/ipc";
import { addLocalDays, formatTimeOfDay } from "@/shared/lib/time";

const dayFormat = { year: "numeric", month: "short", day: "numeric" } as const;

/** `Today at 9:12 AM`, `Yesterday at 9:12 AM`, `Oct 3, 2026 at 9:12 AM`, or `Never`. */
export function lastBackupLabel(at: number | null, now: number, t: Messages, locale?: string): string {
  const words = t.data;
  if (at === null) return words.never;
  const time = formatTimeOfDay(at, locale);
  const startOfToday = addLocalDays(now, 0);
  if (at >= startOfToday) return words.today(time);
  if (at >= addLocalDays(now, -1)) return words.yesterday(time);
  return words.dateAt(new Date(at).toLocaleDateString(locale, dayFormat), time);
}

/** The first and last day of the tracked time in a file, or `null` when it has none. */
export function previewSpan(preview: RestorePreviewDto, t: Messages, locale?: string): string | null {
  if (preview.first_at === null || preview.last_at === null) return null;
  const first = new Date(preview.first_at).toLocaleDateString(locale, dayFormat);
  const last = new Date(preview.last_at).toLocaleDateString(locale, dayFormat);
  return first === last ? first : t.data.span(first, last);
}

/** Plain-language confirmation text: what the file holds and what the restore replaces. */
export function restoreParagraphs(preview: RestorePreviewDto, t: Messages, locale?: string): string[] {
  const words = t.data;
  const span = previewSpan(preview, t, locale);
  const count = (n: number) => n.toLocaleString(locale);
  const contents = [
    words.segments(count(preview.segments), preview.segments === 1),
    words.activities(count(preview.activities), preview.activities === 1),
    words.rules(count(preview.rules), preview.rules === 1),
  ].join(", ");
  const paragraphs = [words.holds(preview.file_name, contents, span), words.replaces];
  if (preview.kind === "export") paragraphs.splice(1, 0, words.exportOnly);
  return paragraphs;
}
