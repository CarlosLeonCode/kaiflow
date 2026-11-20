import type { Messages } from "@/shared/i18n";
import type { DeleteOpDto, RangeDto, RetentionImpactDto } from "@/shared/ipc";
import { addLocalDays } from "@/shared/lib/time";

/** Pure helpers for the destructive operations of the Privacy section. */

/** `YYYY-MM-DD` of a local date, the value format of `<input type="date">`. */
export function toDateInput(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  // `new Date(2026, 1, 31)` rolls over to March: reject dates that do not exist.
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/**
 * Local `[start of first day, start of the day after the last day)` for two date inputs
 * (both days inclusive), or `null` when a date is missing, impossible, or the order is wrong.
 * Built from calendar dates so DST days are 23 or 25 hours long, never shifted.
 */
export function rangeFromDays(from: string, to: string): RangeDto | null {
  const first = parseDateInput(from);
  const last = parseDateInput(to);
  if (!first || !last || first.getTime() > last.getTime()) return null;
  return { from: first.getTime(), to: addLocalDays(last.getTime(), 1) };
}

export type DaysProblem = "empty" | "invalid";

/** Whole number of days, at least 1 (the backend rejects 0). */
export function parseDays(value: string): { days: number } | { problem: DaysProblem } {
  if (value.trim() === "") return { problem: "empty" };
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 36_500 ? { days } : { problem: "invalid" };
}

export interface DeleteCopy {
  title: string;
  /** Plain-language consequences, one paragraph each. */
  paragraphs: string[];
  confirmLabel: string;
}

const dayFormat = { year: "numeric", month: "short", day: "numeric" } as const;

/**
 * What a purge of old data would touch, in plain words: how much goes and, when it reaches
 * into an active goal streak, a warning before the user confirms.
 */
export function impactParagraphs(impact: RetentionImpactDto | undefined, t: Messages, locale?: string): string[] {
  if (!impact) return [];
  const words = t.privacy.confirm;
  const paragraphs = [
    impact.segments === 0
      ? words.impactNone
      : words.impactSegments(impact.segments.toLocaleString(locale), impact.segments === 1),
  ];
  if (impact.streak_days_cut !== null) paragraphs.push(words.streakWarning(impact.streak_days_cut));
  return paragraphs;
}

/**
 * Confirmation copy for an operation: what goes, what stays, and that it cannot be undone.
 * `impact` is the dry run of a purge (`older_than_days` only).
 */
export function deleteCopy(
  op: DeleteOpDto,
  t: Messages,
  options: { trackingWillRestart?: boolean; impact?: RetentionImpactDto; locale?: string } = {},
): DeleteCopy {
  const words = t.privacy.confirm;
  const { trackingWillRestart = false, impact, locale } = options;
  switch (op.kind) {
    case "range": {
      const from = new Date(op.range.from).toLocaleDateString(locale, dayFormat);
      const last = new Date(addLocalDays(op.range.to, -1)).toLocaleDateString(locale, dayFormat);
      const span = from === last ? from : words.span(from, last);
      return {
        title: words.rangeTitle,
        paragraphs: [words.rangeBody(span), `${words.kept} ${words.cannotUndo}`],
        confirmLabel: words.rangeConfirm,
      };
    }
    case "older_than_days":
      return {
        title: words.olderTitle(op.days),
        paragraphs: [
          words.olderBody(op.days),
          ...impactParagraphs(impact, t, locale),
          `${words.kept} ${words.cannotUndo}`,
        ],
        confirmLabel: words.olderConfirm,
      };
    case "all":
      return {
        title: words.allTitle,
        paragraphs: [
          words.allBody,
          trackingWillRestart ? `${words.kept} ${words.allRestart}` : words.kept,
          words.cannotUndo,
        ],
        confirmLabel: words.allConfirm,
      };
  }
}

/** `Deleted 12 segments`, or the neutral wording when the backend reports no count. */
export function deletedMessage(op: DeleteOpDto, removed: number, t: Messages): string {
  const words = t.privacy.confirm;
  if (op.kind === "all") return words.deletedAll;
  return removed === 0 ? words.deletedNone : words.deleted(removed);
}
