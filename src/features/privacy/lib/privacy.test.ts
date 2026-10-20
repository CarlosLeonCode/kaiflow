import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HOUR } from "@/shared/lib/time";

import { bundleIdProblem, privacyRows } from "./apps";
import { deleteCopy, deletedMessage, parseDays, rangeFromDays, toDateInput } from "./delete";
import { retentionOptions, retentionPatch, retentionValue } from "./retention";

const originalTz = process.env.TZ;

describe("rangeFromDays (America/New_York)", () => {
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("covers both days fully, from local midnight to the next local midnight", () => {
    const range = rangeFromDays("2026-10-19", "2026-10-20");
    expect(range).toEqual({ from: new Date(2026, 9, 19).getTime(), to: new Date(2026, 9, 21).getTime() });
  });

  it("keeps the real length of a DST day", () => {
    const spring = rangeFromDays("2026-03-08", "2026-03-08");
    const fall = rangeFromDays("2026-11-01", "2026-11-01");
    expect(spring && (spring.to - spring.from) / HOUR).toBe(23);
    expect(fall && (fall.to - fall.from) / HOUR).toBe(25);
  });

  it("rejects missing, impossible and reversed dates", () => {
    expect(rangeFromDays("", "2026-10-20")).toBeNull();
    expect(rangeFromDays("2026-10-20", "2026-10-19")).toBeNull();
    expect(rangeFromDays("2026-02-31", "2026-03-01")).toBeNull();
    expect(rangeFromDays("nope", "nope")).toBeNull();
  });

  it("formats a local date for the date input", () => {
    expect(toDateInput(new Date(2026, 2, 8, 23, 30).getTime())).toBe("2026-03-08");
    expect(toDateInput(new Date(2026, 0, 5).getTime())).toBe("2026-01-05");
  });

  it("describes a single day and a span", () => {
    const one = rangeFromDays("2026-03-08", "2026-03-08")!;
    const span = rangeFromDays("2026-03-01", "2026-03-08")!;
    expect(deleteCopy({ kind: "range", range: one }).paragraphs[0]).not.toContain(" to ");
    expect(deleteCopy({ kind: "range", range: span }).paragraphs[0]).toContain(" to ");
  });
});

describe("parseDays", () => {
  it("accepts whole days of at least 1", () => {
    expect(parseDays("30")).toEqual({ days: 30 });
    expect(parseDays(" 1 ")).toEqual({ days: 1 });
  });

  it("rejects empty, zero, negative, fractional and absurd values", () => {
    expect(parseDays("")).toEqual({ problem: "empty" });
    for (const bad of ["0", "-3", "1.5", "abc", "99999999"]) expect(parseDays(bad)).toEqual({ problem: "invalid" });
  });
});

describe("deleteCopy", () => {
  it("always says it is permanent and what stays", () => {
    for (const op of [
      { kind: "older_than_days", days: 30 },
      { kind: "all" },
    ] as const) {
      const text = deleteCopy(op).paragraphs.join(" ");
      expect(text).toContain("cannot be undone");
      expect(text.toLowerCase()).toMatch(/settings|categories/);
    }
  });

  it("uses singular and plural and mentions the tracking pause for delete-all", () => {
    expect(deleteCopy({ kind: "older_than_days", days: 1 }).title).toBe("Delete everything older than 1 day?");
    expect(deleteCopy({ kind: "older_than_days", days: 90 }).title).toContain("90 days");
    expect(deleteCopy({ kind: "all" }, true).paragraphs.join(" ")).toContain("Tracking pauses");
    expect(deleteCopy({ kind: "all" }, false).paragraphs.join(" ")).not.toContain("Tracking pauses");
  });

  it("reports the outcome", () => {
    expect(deletedMessage({ kind: "all" }, 0)).toBe("All tracked data was deleted.");
    expect(deletedMessage({ kind: "older_than_days", days: 3 }, 1)).toBe("Deleted 1 segment.");
    expect(deletedMessage({ kind: "older_than_days", days: 3 }, 12)).toBe("Deleted 12 segments.");
    expect(deletedMessage({ kind: "older_than_days", days: 3 }, 0)).toContain("Nothing matched");
  });
});

describe("retention", () => {
  it("offers presets plus an unusual current value, sorted", () => {
    expect(retentionOptions(null).map((o) => o.value)).toEqual(["forever", "30", "90", "180", "365"]);
    expect(retentionOptions(45).map((o) => o.value)).toEqual(["forever", "30", "45", "90", "180", "365"]);
  });

  it("maps between the setting and the select", () => {
    expect(retentionValue(null)).toBe("forever");
    expect(retentionValue(90)).toBe("90");
    expect(retentionPatch("forever")).toEqual({ kind: "forever" });
    expect(retentionPatch("90")).toEqual({ kind: "days", days: 90 });
  });
});

describe("privacy rows", () => {
  it("lists excluded apps before redacted ones with friendly names", () => {
    const rows = privacyRows(
      { store_titles: true, excluded_apps: ["com.b", "com.a"], redacted_apps: ["com.c"] },
      [{ id: "com.a", name: "Alpha" }],
    );
    expect(rows.map((r) => [r.name, r.mode])).toEqual([
      ["Alpha", "exclude"],
      ["com.b", "exclude"],
      ["com.c", "redact_title"],
    ]);
  });

  it("validates bundle ids loosely", () => {
    expect(bundleIdProblem("")).not.toBeNull();
    expect(bundleIdProblem("Slack")).not.toBeNull();
    expect(bundleIdProblem("com bad.id")).not.toBeNull();
    expect(bundleIdProblem(" com.tinyspeck.slackmacgap ")).toBeNull();
  });
});
