import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import { commands, type MomentDto, type ProgressDto } from "@/shared/ipc";
import { settingsPatch } from "@/shared/ipc/queries";

import { installMockBackend, type MockOptions } from "./mockBackend";

const NOW = new Date(2026, 10, 23, 18, 0, 0).getTime();

async function ok<T>(result: Promise<{ status: "ok"; data: T } | { status: "error"; error: unknown }>): Promise<T> {
  const settled = await result;
  if (settled.status === "error") throw new Error(JSON.stringify(settled.error));
  return settled.data;
}

function install(options: MockOptions = {}) {
  installMockBackend({ now: () => NOW, ...options });
}

/** Dismisses moments until none is left; returns them in the order they came. */
async function drain(progress: ProgressDto): Promise<MomentDto[]> {
  const seen: MomentDto[] = [];
  let current = progress;
  while (current.moment && seen.length < 10) {
    seen.push(current.moment);
    current = await ok(commands.dismissMoment(current.moment));
  }
  return seen;
}

describe("the mocked progress backend", () => {
  afterEach(() => clearMocks());

  it("reports the demo level, day, streak and seals", async () => {
    install();
    const progress = await ok(commands.getProgress());
    expect(progress.enabled).toBe(true);
    expect(progress.level).toEqual({
      number: 4,
      name: "flow",
      total: 2_410,
      into_level: 410,
      span: 2_000,
      next_name: "craft",
    });
    expect(progress.today).toMatchObject({ strokes: 35, cap: 100, done: false });
    expect(progress.today.entries.reduce((sum, e) => sum + e.strokes, 0)).toBe(35);
    expect(progress.today.entries.every((e) => e.at <= NOW)).toBe(true);
    expect(progress.streak.current).toBe(5);
    expect(progress.streak.last7).toHaveLength(7);
    expect(progress.seals.map((s) => s.id)).toEqual([
      "first_focus",
      "seven_days",
      "ten_sessions",
      "took_the_break",
      "perfect_week",
      "thirty_days",
    ]);
    expect(progress.seals.filter((s) => !s.earned).map((s) => `${s.current}/${s.target}`)).toEqual(["2/7", "12/30"]);
  });

  it("celebrates the unseen seal once", async () => {
    install();
    const progress = await ok(commands.getProgress());
    expect(await drain(progress)).toEqual([{ kind: "seal", seal: "ten_sessions" }]);
    const after = await ok(commands.getProgress());
    expect(after.moment).toBeNull();
    expect(after.seals.filter((s) => s.earned).every((s) => s.seen)).toBe(true);
  });

  it("has a full day or a level-up waiting on request", async () => {
    install({ demoProgress: "done" });
    const done = await ok(commands.getProgress());
    expect(done.today).toMatchObject({ strokes: 100, done: true });
    const day = Math.round(Date.UTC(2026, 10, 23) / 86_400_000);
    expect(await drain(done)).toEqual([{ kind: "day_done", day }]);

    clearMocks();
    install({ demoProgress: "level" });
    expect(await drain(await ok(commands.getProgress()))).toEqual([{ kind: "level", number: 4, name: "flow" }]);
  });

  it("follows the progress_enabled setting", async () => {
    install({ progressEnabled: false });
    expect((await ok(commands.getProgress())).enabled).toBe(false);
    await ok(commands.settingsUpdate(settingsPatch({ progress_enabled: true })));
    expect((await ok(commands.getProgress())).enabled).toBe(true);
  });
});
