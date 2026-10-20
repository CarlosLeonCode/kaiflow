import { describe, expect, it } from "vitest";

import { describeError, IpcError, unwrap } from "./client";

describe("unwrap", () => {
  it("returns the data of an ok result", async () => {
    await expect(unwrap(Promise.resolve({ status: "ok" as const, data: 7 }))).resolves.toBe(7);
  });

  it("throws an IpcError carrying the typed AppError", async () => {
    const failure = unwrap(
      Promise.resolve({
        status: "error" as const,
        error: { kind: "shortcut_unavailable" as const, shortcut: "⌃⌥⌘T", reason: "taken" },
      }),
    );
    await expect(failure).rejects.toBeInstanceOf(IpcError);
    await expect(failure).rejects.toMatchObject({ error: { kind: "shortcut_unavailable" } });
  });

  it("describes every error kind with a readable message", () => {
    expect(describeError({ kind: "invalid_pattern", pattern: "(", reason: "unclosed" })).toContain("(");
    expect(describeError({ kind: "storage", message: "disk full" })).toBe("disk full");
    expect(describeError({ kind: "not_found" })).toMatch(/no longer exists/);
  });
});
