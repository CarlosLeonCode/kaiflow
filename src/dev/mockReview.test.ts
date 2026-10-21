import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { commands } from "@/shared/ipc";

import { installMockBackend } from "./mockBackend";

const NOW = new Date(2026, 9, 21, 12, 0, 0).getTime();

async function ok<T>(result: Promise<{ status: "ok"; data: T } | { status: "error"; error: unknown }>): Promise<T> {
  const settled = await result;
  if (settled.status === "error") throw new Error(JSON.stringify(settled.error));
  return settled.data;
}

async function error(result: Promise<{ status: "ok" | "error"; error?: unknown }>): Promise<{ kind: string; [k: string]: unknown }> {
  const settled = await result;
  if (settled.status === "ok") throw new Error("expected a failure");
  return settled.error as { kind: string };
}

const off = { patch: { selected: null, include_titles: null, monday_review: null, provider: null } };

function enable(provider: "anthropic" | "ollama") {
  return commands.aiSettingsUpdate({
    ...off.patch,
    selected: provider,
    provider: { provider, enabled: true, model: provider === "ollama" ? "llama3.2" : null, base_url: null },
  });
}

describe("the mocked review backend mirrors the real guards", () => {
  beforeEach(() => installMockBackend({ now: () => NOW }));
  afterEach(() => clearMocks());

  it("sends no AI traffic before the opt-in", async () => {
    const traffic = (globalThis as { __mockAiTraffic?: () => number }).__mockAiTraffic;
    expect(await error(commands.aiModelsList("anthropic"))).toEqual({ kind: "ai_not_enabled" });
    expect(await error(commands.reviewPreview(0, false, "English"))).toEqual({ kind: "ai_not_enabled" });
    expect(await error(commands.aiTest("ollama"))).toEqual({ kind: "ai_not_enabled" });
    expect(traffic?.()).toBe(0);
    // The local summary needs no AI at all.
    const week = await ok(commands.reviewGet(0));
    expect(week.dashboard.total_ms).toBeGreaterThan(0);
  });

  it("previews are single use and runs store the review", async () => {
    await ok(enable("ollama"));
    const preview = await ok(commands.reviewPreview(0, false, "English"));
    expect(preview.included_titles).toBe(false);
    expect(preview.user).not.toContain("window_titles");
    const review = await ok(commands.reviewRun(preview.id));
    expect(review.status).toBe("ok");
    expect((await ok(commands.aiReviewsList())).map((r) => r.id)).toEqual([review.id]);
    expect(await error(commands.reviewRun(preview.id))).toEqual({ kind: "not_found" });
    const week = await ok(commands.reviewGet(0));
    expect(week.reviews).toHaveLength(1);
  });

  it("only includes titles when asked", async () => {
    await ok(enable("ollama"));
    const withTitles = await ok(commands.reviewPreview(0, true, "English"));
    expect(withTitles.user).toContain("window_titles");
    expect(withTitles.title_count).toBeGreaterThan(0);
    expect(withTitles.title_count).toBeLessThanOrEqual(20);
  });

  it("deletes one review and all of them only with the token", async () => {
    await ok(enable("ollama"));
    for (let i = 0; i < 3; i++) {
      await ok(commands.reviewRun((await ok(commands.reviewPreview(0, false, "English"))).id));
    }
    const [first] = await ok(commands.aiReviewsList());
    await ok(commands.aiReviewsDelete(first?.id ?? 0));
    expect(await ok(commands.aiReviewsList())).toHaveLength(2);
    expect(await error(commands.aiReviewsDeleteAll("forged"))).toEqual({ kind: "confirmation_required" });
    const token = await ok(commands.aiReviewsPrepareDeleteAll());
    expect(await ok(commands.aiReviewsDeleteAll(token))).toBe(2);
    expect(await ok(commands.aiReviewsList())).toHaveLength(0);
  });

  it("refuses remote Ollama addresses and keeps notes per week", async () => {
    const result = await commands.aiSettingsUpdate({
      ...off.patch,
      provider: { provider: "ollama", enabled: null, model: null, base_url: "https://example.com" },
    });
    expect(result.status === "error" && result.error.kind === "ai").toBe(true);

    const week = await ok(commands.reviewGet(0));
    await ok(commands.reviewNoteSet(week.first_day, "  hello  "));
    expect((await ok(commands.reviewGet(0))).note).toBe("hello");
    expect((await ok(commands.reviewGet(1))).note).toBe("");
  });

  it("keys never come back and the key store can be missing", async () => {
    const settings = await ok(commands.aiSetKey("anthropic", "sk-ant-secret-123"));
    expect(JSON.stringify(settings)).not.toContain("sk-ant-secret-123");
    expect(settings.providers[0]?.has_key).toBe(true);
    expect(await ok(commands.aiHasKey("anthropic"))).toBe(true);
    clearMocks();
    installMockBackend({ now: () => NOW, keychainMissing: true });
    expect(await error(commands.aiSetKey("anthropic", "sk-ant-secret-123"))).toMatchObject({ kind: "secret_store_unavailable" });
    expect((await ok(commands.aiSettingsGet())).secret_store.available).toBe(false);
  });
});
