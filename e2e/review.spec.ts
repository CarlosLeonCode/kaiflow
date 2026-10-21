import { expect, expectNoA11yViolations, openWindow, test } from "./fixtures";

type Page = Parameters<typeof openWindow>[0];

async function openReview(page: Page, query = "") {
  await openWindow(page, "main", query);
  await page.getByRole("navigation").getByRole("button", { name: /^Review/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Review" })).toBeVisible();
}

async function openAiSettings(page: Page, query = "") {
  await openWindow(page, "main", query);
  await page.getByRole("navigation").getByRole("button", { name: /^Settings/ }).click();
  await expect(page.getByRole("region", { name: "AI analysis" })).toBeVisible();
}

const aiTraffic = (page: Page) => page.evaluate(() => (globalThis as { __mockAiTraffic?: () => number }).__mockAiTraffic?.() ?? -1);
const ipcCalls = (page: Page) => page.evaluate(() => (globalThis as { __mockIpcCalls?: string[] }).__mockIpcCalls ?? []);

test.describe("Weekly review without AI", () => {
  test("builds the week locally and explains that AI is off, with no AI traffic", async ({ page }) => {
    await openReview(page);

    await expect(page.getByTestId("review-heading")).toHaveText("This week");
    await expect(page.getByTestId("review-week")).toHaveText("2026-03-16 to 2026-03-22");
    await expect(page.getByTestId("review-total")).not.toHaveText("0s");
    await expect(page.getByRole("list", { name: "Time by activity" })).toBeVisible();
    await expect(page.getByRole("grid", { name: "Tracked time by weekday and hour" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Goals" })).toContainText("No goals to review.");
    await expect(page.getByRole("region", { name: "Focus sessions" })).toContainText("No focus sessions this week.");

    // The privacy story, in plain words, and the next step.
    await expect(page.getByRole("region", { name: "AI analysis (optional)" })).toContainText(
      "nothing is sent anywhere until you switch a provider on",
    );
    await expect(page.getByRole("button", { name: /Set up AI in Settings/ })).toBeVisible();
    await expectNoA11yViolations(page);

    expect(await aiTraffic(page)).toBe(0);
    const calls = await ipcCalls(page);
    for (const forbidden of ["review_preview", "review_run", "ai_models_list", "ai_test"]) {
      expect(calls).not.toContain(forbidden);
    }
  });

  test("an empty week shows an explanation and still takes a note", async ({ page }) => {
    await openReview(page, "?data=empty");

    await expect(page.getByRole("heading", { name: "Nothing tracked this week yet" })).toBeVisible();
    await expect(page.getByLabel("Your note about this week")).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("a personal note is saved per week", async ({ page }) => {
    await openReview(page);

    await page.getByLabel("Your note about this week").fill("Felt rushed on Tuesday");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.getByRole("button", { name: "Previous week" }).click();
    await expect(page.getByTestId("review-heading")).toHaveText("Last week");
    await expect(page.getByLabel("Your note about this week")).toHaveValue("");
    await page.getByRole("button", { name: "This week" }).click();
    await expect(page.getByLabel("Your note about this week")).toHaveValue("Felt rushed on Tuesday");
  });

  test("shows how goals fared and offers to create one", async ({ page }) => {
    await openReview(page, "?goals=demo");

    const goals = page.getByRole("list", { name: "Goals this week" });
    await expect(goals).toContainText("Deep work");
    await expect(goals).toContainText("Slack limit");
    await expect(goals).toContainText(/Met on \d of \d active days?\./);
    await expect(goals).toContainText("Weekly development");
  });
});

test.describe("Settings > AI", () => {
  test("is off by default and opening it contacts nothing", async ({ page }) => {
    await openAiSettings(page);

    await expect(page.getByRole("switch", { name: "Use Anthropic (Claude)" })).not.toBeChecked();
    await expect(page.getByText(/Nothing is sent to any AI provider unless you switch one on/)).toBeVisible();
    expect(await aiTraffic(page)).toBe(0);
    await expectNoA11yViolations(page);
  });

  test("a cloud provider needs the key in the keychain and the key is never shown again", async ({ page }) => {
    await openAiSettings(page);

    await page.getByRole("switch", { name: "Use Anthropic (Claude)" }).click();
    await expect(page.getByRole("switch", { name: "Use Anthropic (Claude)" })).toBeChecked();

    const key = page.getByPlaceholder("Paste API key");
    await expect(key).toHaveAttribute("type", "password");
    await key.fill("sk-ant-secret-123");
    await page.getByRole("button", { name: "Save key" }).click();
    await expect(page.getByRole("button", { name: "Remove key" })).toBeVisible();
    await expect(page.getByText(/Saved in your system keychain/)).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("sk-ant-secret-123");
    await expect(page.getByLabel("Model")).toHaveValue("claude-haiku-5-5");

    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByTestId("ai-notice")).toContainText("Connected.");
    await expectNoA11yViolations(page);

    // Removing the key also switches the provider off.
    await page.getByRole("button", { name: "Remove key" }).click();
    await expect(page.getByRole("switch", { name: "Use Anthropic (Claude)" })).not.toBeChecked();
  });

  test("refuses keys when the OS has no secure store, never falling back to plain text", async ({ page }) => {
    await openAiSettings(page, "?keychain=missing");

    await expect(page.getByTestId("ai-keychain-unavailable")).toContainText("never stored in plain text");
    await expect(page.getByPlaceholder("Paste API key")).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "Use Anthropic (Claude)" })).toBeDisabled();
    await expectNoA11yViolations(page);

    // A model on this computer still works without a key.
    await page.getByRole("combobox", { name: "Provider" }).selectOption("ollama");
    await expect(page.getByRole("switch", { name: "Use Ollama (on this computer)" })).toBeEnabled();
  });

  test("Ollama only accepts a local address", async ({ page }) => {
    await openAiSettings(page);
    await page.getByRole("combobox", { name: "Provider" }).selectOption("ollama");

    const address = page.getByLabel("Ollama address");
    await address.fill("https://example.com");
    await address.blur();
    await expect(page.getByTestId("ai-settings-error")).toContainText("only localhost addresses are allowed");
  });
});

test.describe("Weekly review with AI", () => {
  test("previews the exact data, sends on confirmation and keeps a history", async ({ page }) => {
    await openReview(page, "?ai=on");

    await page.getByRole("button", { name: /Preview what will be sent/ }).click();
    const preview = page.getByTestId("request-preview");
    await expect(preview.getByTestId("preview-destination")).toContainText("Handled by Ollama (on this computer)");
    await expect(preview.getByTestId("preview-destination")).toContainText("Window titles are not included.");
    await expect(preview.getByTestId("preview-data")).toContainText('"tracked_minutes"');
    await expect(preview.getByTestId("preview-data")).not.toContainText("window_titles");
    expect(await aiTraffic(page)).toBe(0);
    await expectNoA11yViolations(page);

    await preview.getByRole("button", { name: "Analyze on this computer" }).click();
    await expect(page.getByTestId("review-summary")).toContainText("You tracked");
    expect(await aiTraffic(page)).toBe(1);
    await expect(page.getByRole("region", { name: "Suggestions" })).toBeVisible();
    await expectNoA11yViolations(page);

    const saved = page.getByRole("list", { name: "Saved analyses" });
    await expect(saved).toContainText("2026-03-16 to 2026-03-22");
    await page.getByRole("button", { name: /Delete analysis of 2026-03-16 to 2026-03-22/ }).click();
    await expect(page.getByRole("list", { name: "Saved analyses" })).toHaveCount(0);
    await expect(page.getByText("No analysis of this week yet.")).toBeVisible();
  });

  test("window titles are opt-in and the preview shows them", async ({ page }) => {
    await openReview(page, "?ai=on");

    await page.getByRole("switch", { name: "Include window titles" }).click();
    await page.getByRole("button", { name: /Preview what will be sent/ }).click();
    const preview = page.getByTestId("request-preview");
    await expect(preview.getByTestId("preview-destination")).toContainText(/Includes \d+ window titles?/);
    await expect(preview.getByTestId("preview-data")).toContainText("window_titles");
    await preview.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("request-preview")).toHaveCount(0);
    expect(await aiTraffic(page)).toBe(0);
  });

  test("deleting every analysis needs a confirmation", async ({ page }) => {
    await openReview(page, "?ai=on");

    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: /Preview what will be sent/ }).click();
      await page.getByRole("button", { name: "Analyze on this computer" }).click();
      await expect(page.getByRole("list", { name: "Saved analyses" }).locator("> li")).toHaveCount(i + 1);
    }

    await page.getByRole("button", { name: "Delete all" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Delete all saved analyses?" });
    await expectNoA11yViolations(page);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("list", { name: "Saved analyses" }).locator("> li")).toHaveCount(2);

    await page.getByRole("button", { name: "Delete all" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete all" }).click();
    await expect(page.getByRole("list", { name: "Saved analyses" })).toHaveCount(0);
  });

  test("a network failure gives a clear message and saves nothing", async ({ page }) => {
    await openReview(page, "?ai=offline");

    await page.getByRole("button", { name: /Preview what will be sent/ }).click();
    await page.getByRole("button", { name: "Analyze on this computer" }).click();

    await expect(page.getByTestId("ai-error")).toContainText("Check your internet connection");
    await expect(page.getByText("No analysis of this week yet.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Saved analyses" })).toHaveCount(0);
    await expectNoA11yViolations(page);
  });
});
