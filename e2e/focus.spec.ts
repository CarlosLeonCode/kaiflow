import { expect, expectNoA11yViolations, openWindow, test } from "./fixtures";

async function openFocus(page: Parameters<typeof openWindow>[0], query = "") {
  await openWindow(page, "main", query);
  await page.getByRole("navigation").getByRole("button", { name: /^Focus/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Focus" })).toBeVisible();
}

test.describe("Focus", () => {
  test("starts with an invitation to start the first session", async ({ page }) => {
    await openFocus(page);

    await expect(page.getByRole("heading", { name: "No focus sessions yet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start a session" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("runs a full session: start, countdown, end early and a summary to dismiss", async ({ page }) => {
    await openFocus(page);

    await page.getByRole("button", { name: "Start session" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Start a focus session" });
    // Nothing is preselected, and an incomplete form says what is missing.
    await dialog.getByRole("button", { name: "Start session" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Describe what you want to focus on.");
    await dialog.getByRole("textbox", { name: /What do you want to focus on/ }).fill("Write report");
    await dialog.getByRole("radio", { name: "50 min" }).click();
    await dialog.getByRole("group", { name: "Allowed activities" }).getByRole("checkbox", { name: "Development" }).check();
    await dialog.getByRole("group", { name: "Allowed apps" }).getByRole("checkbox", { name: "Safari" }).check();
    await expectNoA11yViolations(page);
    await dialog.getByRole("button", { name: "Start session" }).click();

    const card = page.getByRole("region", { name: "Focus session" });
    await expect(card).toContainText("Write report");
    await expect(card.getByTestId("focus-countdown")).toHaveText("50:00");
    await expect(card).toContainText("Allowed: 1 activity and 1 app");
    await expect(page.getByRole("button", { name: "Start session" })).toBeDisabled();
    await expectNoA11yViolations(page);

    await card.getByRole("button", { name: "+10 min" }).click();
    await expect(card.getByTestId("focus-countdown")).toHaveText("1:00:00");

    await card.getByRole("button", { name: "End session" }).click();
    const summary = page.getByRole("region", { name: "Session summary" });
    await expect(summary).toContainText("Ended early");
    await expect(summary).toContainText("Write report");
    await expectNoA11yViolations(page);
    await summary.getByRole("button", { name: "Done" }).click();
    await expect(summary).toHaveCount(0);

    const history = page.getByRole("region", { name: "Recent sessions" });
    await expect(history).toContainText("Write report");
    await expect(history).toContainText("Ended early");
  });

  test("a drift shows a gentle card; allowing the app clears it", async ({ page }) => {
    await openFocus(page, "?focus=drift");

    const alert = page.getByRole("status", { name: "Drift alert" });
    await expect(alert).toContainText("Still on track?");
    await expect(alert).toContainText("You have been in Xcode for a while");
    await expectNoA11yViolations(page);
    await alert.getByRole("button", { name: "Allow this app" }).click();

    await expect(alert).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Focus session" })).toContainText("Allowed: 1 activity and 1 app");
  });

  test("back to it snoozes the alert", async ({ page }) => {
    await openFocus(page, "?focus=drift");

    await page.getByRole("button", { name: "Back to it" }).click();
    await expect(page.getByRole("status", { name: "Drift alert" })).toHaveCount(0);
    // Still running: only the alert is gone.
    await expect(page.getByRole("region", { name: "Focus session" })).toBeVisible();
  });

  test("a session on target shows no alert", async ({ page }) => {
    await openFocus(page, "?focus=running");

    await expect(page.getByTestId("focus-countdown")).toHaveText("40:00");
    await expect(page.getByRole("status", { name: "Drift alert" })).toHaveCount(0);
  });

  test("is blocked with a clear reason when tracking is degraded", async ({ page }) => {
    await openFocus(page, "?permission=denied");

    await expect(page.getByText("Focus sessions are unavailable")).toBeVisible();
    await expect(page.getByText(/Accessibility access is not granted/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Start session" })).toBeDisabled();
    await expectNoA11yViolations(page);
  });

  test("the running session also shows in Today and in the popover", async ({ page }) => {
    await openWindow(page, "main", "?focus=running");
    await expect(page.getByRole("region", { name: "Focus session" })).toContainText("Write report");

    await openWindow(page, "popover", "?focus=drift");
    const alert = page.getByRole("status", { name: "Drift alert" });
    await expect(alert).toBeVisible();
    await expectNoA11yViolations(page);
    await alert.getByRole("button", { name: "Back to it" }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Focus session" })).toBeVisible();
  });

  test("the drift delay is a setting", async ({ page }) => {
    await openWindow(page, "main");
    await page.getByRole("navigation").getByRole("button", { name: /^Settings/ }).click();

    const delay = page.getByRole("combobox", { name: "Nudge me after" });
    await expect(delay).toHaveValue("90");
    await delay.selectOption({ label: "3 min" });
    await expect(delay).toHaveValue("180");
  });
});
