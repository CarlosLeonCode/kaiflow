import { describe, expect, it } from "vitest";

import { kaiPose } from "./kai";

const focus = { kind: "focus", paused_at: null } as const;

describe("kaiPose", () => {
  it("says hello while tracking with nothing running", () => {
    expect(kaiPose({ done: false, block: null, tracking: "running" })).toBe("hello");
    expect(kaiPose({ done: false, block: null, tracking: "idle" })).toBe("hello");
  });

  it("focuses while a focus block or a timer runs", () => {
    expect(kaiPose({ done: false, block: focus, tracking: "running" })).toBe("focus");
    expect(kaiPose({ done: false, block: { kind: "timer", paused_at: null }, tracking: "running" })).toBe("focus");
  });

  it("rests during a break, a paused block, or with tracking paused or off", () => {
    expect(kaiPose({ done: false, block: { kind: "break", paused_at: null }, tracking: "running" })).toBe("rest");
    expect(kaiPose({ done: false, block: { kind: "focus", paused_at: 1 }, tracking: "running" })).toBe("rest");
    expect(kaiPose({ done: false, block: null, tracking: "paused" })).toBe("rest");
    expect(kaiPose({ done: false, block: focus, tracking: "stopped" })).toBe("rest");
  });

  it("celebrates a full ensō above everything else", () => {
    expect(kaiPose({ done: true, block: focus, tracking: "running" })).toBe("done");
    expect(kaiPose({ done: true, block: null, tracking: "stopped" })).toBe("done");
  });
});
