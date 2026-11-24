import { describe, expect, it } from "vitest";

import type { StrokeEntryDto } from "@/shared/ipc";
import { en, es } from "@/shared/i18n";

import { momentContent } from "./moment";
import { fraction, ledgerRows, nextLevel, weekdayInitials } from "./progress";

describe("ledgerRows", () => {
  it("groups today's entries by source and skips strokes past the cap", () => {
    const entries: StrokeEntryDto[] = [
      { source: "focus_completed", strokes: 10, at: 1 },
      { source: "break_taken", strokes: 3, at: 2 },
      { source: "focus_completed", strokes: 10, at: 3 },
      { source: "focus_on_target", strokes: 5, at: 4 },
      { source: "break_taken", strokes: 0, at: 5 },
    ];
    expect(ledgerRows(entries)).toEqual([
      { source: "focus_completed", count: 2, strokes: 20 },
      { source: "focus_on_target", count: 1, strokes: 5 },
      { source: "break_taken", count: 1, strokes: 3 },
    ]);
  });
});

describe("weekdayInitials", () => {
  // Tuesday 20 October 2026, mid-afternoon local time.
  const tuesday = new Date(2026, 9, 20, 15).getTime();

  it("names the seven days ending today, oldest first", () => {
    expect(weekdayInitials("en", tuesday)).toEqual(["W", "T", "F", "S", "S", "M", "T"]);
    expect(weekdayInitials("es", tuesday)).toEqual(["X", "J", "V", "S", "D", "L", "M"]);
  });
});

describe("levels and fractions", () => {
  it("names the next level, none after Kaizen", () => {
    expect(nextLevel("flow")).toBe("craft");
    expect(nextLevel("kaizen")).toBeNull();
  });

  it("clamps fractions and survives a zero whole", () => {
    expect(fraction(35, 100)).toBe(0.35);
    expect(fraction(140, 100)).toBe(1);
    expect(fraction(5, 0)).toBe(0);
  });
});

describe("momentContent", () => {
  it("words a finished day in both languages", () => {
    expect(momentContent({ kind: "day_done", day: 1 }, en)).toEqual({
      tone: "sun",
      title: "Today's ensō is done",
      sentence: "See you tomorrow.",
      linkLabel: "How you earned them",
    });
    expect(momentContent({ kind: "day_done", day: 1 }, es).title).toBe("El ensō de hoy está listo");
  });

  it("names a new seal on pink", () => {
    const content = momentContent({ kind: "seal", seal: "seven_days" }, en);
    expect(content).toMatchObject({ tone: "pink", title: "New seal: Seven days", linkLabel: "See your seals" });
    expect(momentContent({ kind: "seal", seal: "seven_days" }, es).title).toBe("Nuevo sello: Siete días");
  });

  it("announces a level on sky, with the next one or the top", () => {
    expect(momentContent({ kind: "level", number: 5, name: "craft" }, en)).toMatchObject({
      tone: "sky",
      title: "Level 5 · Craft",
      sentence: "A new stretch of the path. Mastery is next.",
    });
    expect(momentContent({ kind: "level", number: 7, name: "kaizen" }, en).sentence).toBe(en.progress.moment.level.top);
    expect(momentContent({ kind: "level", number: 6, name: "mastery" }, es).title).toBe("Nivel 6 · Maestría");
  });
});

describe("progress copy", () => {
  it("pluralizes hints and streaks", () => {
    expect(en.progress.seals.hint.days(12, 30)).toBe("12 of 30 days");
    expect(en.progress.seals.hint.sessions(3, 10)).toBe("3 of 10 sessions");
    expect(en.progress.seals.hint.breaks(0, 1)).toBe("0 of 1 break");
    expect(es.progress.seals.hint.days(12, 30)).toBe("12 de 30 días");
    expect(es.progress.seals.hint.sessions(0, 1)).toBe("0 de 1 sesión");
    expect(en.progress.streak.current(5)).toBe("5-day streak");
    expect(es.progress.streak.current(1)).toBe("Racha de 1 día");
    expect(es.progress.streak.current(5)).toBe("Racha de 5 días");
  });

  it("has no exclamation marks or emoji", () => {
    const strings = (value: unknown): string[] =>
      typeof value === "string"
        ? [value]
        : typeof value === "function"
          ? [String((value as (...a: unknown[]) => unknown)(1, 2, "x"))]
          : Object.values(value as object).flatMap(strings);
    for (const text of [...strings(en.progress), ...strings(es.progress)]) {
      expect(text).not.toMatch(/!|\p{Extended_Pictographic}/u);
    }
  });
});
