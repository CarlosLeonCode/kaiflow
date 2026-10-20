import { describe, expect, it } from "vitest";

import { IpcError } from "@/shared/ipc";

import { toSubmitResult } from "./submit";

describe("toSubmitResult", () => {
  it("attributes an invalid regex to the pattern field with the backend reason", () => {
    const result = toSubmitResult(new IpcError({ kind: "invalid_pattern", pattern: "(", reason: "unclosed group" }));
    expect(result.field).toBe("pattern");
    expect(result.message).toContain("unclosed group");
  });

  it("keeps other backend errors general", () => {
    expect(toSubmitResult(new IpcError({ kind: "storage", message: "disk full" }))).toEqual({ message: "disk full" });
    expect(toSubmitResult(new Error("boom"))).toEqual({ message: "boom" });
    expect(toSubmitResult("weird").message).toBe("Something went wrong.");
  });
});
