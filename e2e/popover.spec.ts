import { expect, expectNoA11yViolations, openWindow, test } from "./fixtures";

test.describe("menu bar popover", () => {
  test("shows tracking status, today's total and the top apps", async ({ page }) => {
    await openWindow(page, "popover");

    await expect(page.getByText("Tracking", { exact: true })).toBeVisible();
    await expect(page.getByTestId("today-total")).toHaveText("4:25:00");
    await expect(page.getByText("Xcode").first()).toBeVisible();
  });

  test("pause and resume change the tracking state", async ({ page }) => {
    await openWindow(page, "popover");

    await page.getByRole("button", { name: /^Pause/ }).click();
    await expect(page.getByText("Paused", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /^Resume/ }).click();
    await expect(page.getByText("Tracking", { exact: true })).toBeVisible();
  });

  test("announces an available update and installs it on request", async ({ page }) => {
    await openWindow(page, "popover", "?update=1");

    await expect(page.getByText("Version 0.2.0 is available")).toBeVisible();
    await page.getByRole("button", { name: "Install and restart" }).click();
    await expect(page.getByText("Installing. The app will restart in a moment.")).toBeVisible();
  });

  test("has no accessibility violations", async ({ page }) => {
    await openWindow(page, "popover", "?update=1");
    await expect(page.getByTestId("today-total")).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
