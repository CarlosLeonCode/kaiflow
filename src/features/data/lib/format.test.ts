import { describe, expect, it } from "vitest";

import type { RestorePreviewDto } from "@/shared/ipc";

import { lastBackupLabel, previewSpan, restoreParagraphs } from "./format";

const NOW = new Date(2026, 9, 20, 15, 0).getTime();

function preview(overrides: Partial<RestorePreviewDto> = {}): RestorePreviewDto {
  return {
    token: "t",
    file_name: "kaiflow-backup-2026-10-19.json.gz",
    kind: "backup",
    app_version: "0.1.0",
    exported_at: "2026-10-19T08:00:00Z",
    activities: 3,
    rules: 1,
    segments: 1200,
    idle_gaps: 4,
    first_at: new Date(2026, 8, 1, 9).getTime(),
    last_at: new Date(2026, 9, 19, 18).getTime(),
    ...overrides,
  };
}

describe("lastBackupLabel", () => {
  it("says Never, Today, Yesterday or the date", () => {
    expect(lastBackupLabel(null, NOW, "en-US")).toBe("Never");
    expect(lastBackupLabel(new Date(2026, 9, 20, 2, 30).getTime(), NOW, "en-US")).toMatch(/^Today at 2:30/);
    expect(lastBackupLabel(new Date(2026, 9, 19, 23, 59).getTime(), NOW, "en-US")).toMatch(/^Yesterday at/);
    expect(lastBackupLabel(new Date(2026, 9, 3, 9, 0).getTime(), NOW, "en-US")).toMatch(/^Oct 3, 2026 at/);
  });
});

describe("restore copy", () => {
  it("lists the counts and the span of tracked time", () => {
    const [summary, warning] = restoreParagraphs(preview(), "en-US");
    expect(summary).toContain("1,200 tracked segments, 3 activities, 1 rule");
    expect(summary).toContain("Sep 1, 2026 to Oct 19, 2026");
    expect(warning).toMatch(/replaces everything stored now/);
    expect(warning).toMatch(/safety copy/);
  });

  it("warns that a range export leaves only that range", () => {
    const paragraphs = restoreParagraphs(preview({ kind: "export" }), "en-US");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[1]).toMatch(/export of a date range/);
  });

  it("copes with a file without tracked time", () => {
    const empty = preview({ first_at: null, last_at: null, segments: 0 });
    expect(previewSpan(empty)).toBeNull();
    expect(restoreParagraphs(empty, "en-US")[0]).toContain("0 tracked segments");
    expect(restoreParagraphs(empty, "en-US")[0]).not.toContain("recorded");
  });
});
