import { expect, expectNoA11yViolations, openWindow, test } from "./fixtures";

async function openFocus(page: Parameters<typeof openWindow>[0], query = "") {
  await openWindow(page, "main", query);
  await page.getByRole("navigation").getByRole("button", { name: /^Focus/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Focus" })).toBeVisible();
}

test.describe("Focus", () => {
  test("opens on a start view with presets, a task field and today's numbers", async ({ page }) => {
    await openFocus(page);

    const form = page.getByRole("form", { name: "Start a block" });
    for (const preset of ["25 min", "50 min", "90 min", "Custom"]) {
      await expect(form.getByRole("radio", { name: preset })).toBeVisible();
    }
    await expect(form.getByRole("radio", { name: "25 min" })).toBeChecked();
    await expect(form.getByRole("button", { name: "Start timer" })).toBeVisible();
    await expect(page.getByLabel("Today")).toContainText("Blocks done today");
    await expectNoA11yViolations(page);
  });

  test("runs a timer: start from a preset, pause, resume, extend and end", async ({ page }) => {
    await openFocus(page);

    const form = page.getByRole("form", { name: "Start a block" });
    await form.getByRole("textbox", { name: "Task" }).fill("Write report");
    await form.getByRole("radio", { name: "50 min" }).click();
    await form.getByRole("button", { name: "Start timer" }).click();

    const card = page.getByRole("region", { name: "Active timer" });
    await expect(card).toContainText("Write report");
    await expect(card).toContainText("Timer");
    await expect(card.getByTestId("focus-countdown")).toHaveText("50:00");
    await expect(card.getByRole("img", { name: "0 of 4 blocks before the long break" })).toBeVisible();
    await expectNoA11yViolations(page);

    await card.getByRole("button", { name: "Pause" }).click();
    await expect(card).toContainText("Paused");
    await expect(card.getByRole("timer")).toHaveAccessibleName("Paused, 50 minutes left");
    await expect(card.getByRole("button", { name: "Resume" })).toBeEnabled();
    await expectNoA11yViolations(page);
    await card.getByRole("button", { name: "Resume" }).click();
    await expect(card.getByRole("button", { name: "Pause" })).toBeVisible();

    await card.getByRole("button", { name: "+5 min" }).click();
    await expect(card.getByTestId("focus-countdown")).toHaveText("55:00");

    await card.getByRole("button", { name: "End" }).click();
    await expect(page.getByRole("form", { name: "Start a block" })).toBeVisible();
    const history = page.getByRole("region", { name: "Recent sessions" });
    await expect(history).toContainText("Write report");
    await expect(history).toContainText("Ended early");
  });

  test("a focus block with allowed apps ends early with a summary to dismiss", async ({ page }) => {
    await openFocus(page);

    const form = page.getByRole("form", { name: "Start a block" });
    await form.getByRole("button", { name: /Advanced: drift nudges/ }).click();
    await form.getByRole("group", { name: "Allowed activities" }).getByRole("checkbox", { name: "Development" }).check();
    await form.getByRole("group", { name: "Allowed apps" }).getByRole("checkbox", { name: "Safari" }).check();
    await expectNoA11yViolations(page);
    await form.getByRole("button", { name: "Start focus" }).click();

    const card = page.getByRole("region", { name: "Active timer" });
    await expect(card.getByTestId("focus-countdown")).toHaveText("25:00");
    await expect(card).toContainText("Allowed: 1 activity and 1 app");
    await card.getByRole("button", { name: "End" }).click();

    const summary = page.getByRole("region", { name: "Session summary" });
    await expect(summary).toContainText("Ended early");
    await expectNoA11yViolations(page);
    await summary.getByRole("button", { name: "Done" }).click();
    await expect(summary).toHaveCount(0);
  });

  test("a drift shows a gentle card; allowing the app clears it", async ({ page }) => {
    await openFocus(page, "?focus=drift");

    const alert = page.getByRole("status", { name: "Drift alert" });
    await expect(alert).toContainText("Still on track?");
    await expect(alert).toContainText("You have been in Xcode for a while");
    await expectNoA11yViolations(page);
    await alert.getByRole("button", { name: "Allow this app" }).click();

    await expect(alert).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Active timer" })).toContainText("Allowed: 1 activity and 1 app");
  });

  test("back to it snoozes the alert", async ({ page }) => {
    await openFocus(page, "?focus=drift");

    await page.getByRole("button", { name: "Back to it" }).click();
    await expect(page.getByRole("status", { name: "Drift alert" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Active timer" })).toBeVisible();
  });

  test("a running focus block shows its ring, countdown and round", async ({ page }) => {
    await openFocus(page, "?focus=running");

    const card = page.getByRole("region", { name: "Active timer" });
    await expect(card.getByTestId("focus-countdown")).toHaveText("40:00");
    await expect(card.getByTestId("timer-ring-progress")).toHaveAttribute("stroke", "var(--primary)");
    await expect(card.getByRole("img", { name: "1 of 4 blocks before the long break" })).toBeVisible();
    await expect(page.getByRole("status", { name: "Drift alert" })).toHaveCount(0);
  });

  test("a break is green and says so", async ({ page }) => {
    await openFocus(page, "?focus=break");

    const card = page.getByRole("region", { name: "Active timer" });
    await expect(card).toContainText("Break");
    await expect(card.getByTestId("focus-countdown")).toHaveText("04:12");
    await expect(card.getByTestId("timer-ring-progress")).toHaveAttribute("stroke", "var(--success)");
    await expectNoA11yViolations(page);
  });

  test("the end card offers a break, and starting it runs one", async ({ page }) => {
    await openFocus(page, "?focus=ended");

    const end = page.getByRole("region", { name: "Block finished" });
    await expect(end.getByRole("heading", { name: "Focus done" })).toBeVisible();
    await expect(end).toContainText("Take a 5-minute break?");
    await expect(end.getByRole("button", { name: "Skip" })).toBeVisible();
    await expect(end.getByRole("button", { name: "+5 min" })).toBeVisible();
    await expectNoA11yViolations(page);
    await end.getByRole("button", { name: "Start break" }).click();

    const card = page.getByRole("region", { name: "Active timer" });
    await expect(card).toContainText("Break");
    await expect(card.getByTestId("focus-countdown")).toHaveText("05:00");
  });

  test("skipping the end card goes back to the start view", async ({ page }) => {
    await openFocus(page, "?focus=ended");

    await page.getByRole("region", { name: "Block finished" }).getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("form", { name: "Start a block" })).toBeVisible();
  });

  test("timers still work while tracking is degraded; drift nudges explain why they do not", async ({ page }) => {
    await openFocus(page, "?permission=denied");

    await expect(page.getByText("Drift nudges are unavailable")).toBeVisible();
    await expect(page.getByText(/Accessibility access is not granted/)).toBeVisible();
    const form = page.getByRole("form", { name: "Start a block" });
    await form.getByRole("button", { name: /Advanced/ }).click();
    await expect(form).toContainText("Drift nudges need window tracking");
    await expect(form.getByRole("checkbox")).toHaveCount(0);
    await expectNoA11yViolations(page);
    await form.getByRole("button", { name: "Start timer" }).click();
    await expect(page.getByRole("region", { name: "Active timer" })).toBeVisible();
  });

  test("the popover starts a timer in one click and shows it", async ({ page }) => {
    await openWindow(page, "popover");

    const start = page.getByRole("region", { name: "Start a timer" });
    await start.getByRole("textbox", { name: "Task (optional)" }).fill("Inbox zero");
    await expectNoA11yViolations(page);
    await start.getByRole("button", { name: "25 min" }).click();

    const card = page.getByRole("region", { name: "Active timer" });
    await expect(card).toContainText("Inbox zero");
    await expect(card.getByTestId("focus-countdown")).toHaveText("25:00");
    await expect(card.getByRole("button", { name: "Pause" })).toBeEnabled();
    await expectNoA11yViolations(page);
    await card.getByRole("button", { name: "Pause" }).click();
    await expect(card.getByRole("button", { name: "Resume" })).toBeVisible();
  });

  test("the popover shows the end card and the drift card", async ({ page }) => {
    await openWindow(page, "popover", "?focus=ended");
    const end = page.getByRole("region", { name: "Block finished" });
    await expect(end).toContainText("Take a 5-minute break?");
    await expectNoA11yViolations(page);

    await openWindow(page, "popover", "?focus=drift");
    const alert = page.getByRole("status", { name: "Drift alert" });
    await expect(alert).toBeVisible();
    await expectNoA11yViolations(page);
    await alert.getByRole("button", { name: "Back to it" }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Active timer" })).toBeVisible();
  });

  test("the running block also shows in Today", async ({ page }) => {
    await openWindow(page, "main", "?focus=running");
    await expect(page.getByRole("region", { name: "Active timer" })).toContainText("Write report");
  });

  test("the cycle, sound and heads-up are settings", async ({ page }) => {
    await openWindow(page, "main");
    await page.getByRole("navigation").getByRole("button", { name: /^Settings/ }).click();

    const delay = page.getByRole("combobox", { name: "Nudge me after" });
    await expect(delay).toHaveValue("90");
    await delay.selectOption({ label: "3 min" });
    await expect(delay).toHaveValue("180");

    const shortBreak = page.getByRole("combobox", { name: "Short break", exact: true });
    await expect(shortBreak).toHaveValue("5");
    await shortBreak.selectOption({ label: "10 min" });
    await expect(shortBreak).toHaveValue("10");
    await expect(page.getByRole("switch", { name: "Sound" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Start the next block automatically" })).not.toBeChecked();
    await page.getByRole("switch", { name: "One-minute heads-up" }).click();
    await expect(page.getByRole("switch", { name: "One-minute heads-up" })).toBeChecked();
    await expectNoA11yViolations(page);
  });
});
