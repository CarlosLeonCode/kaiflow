import { expect, expectNoA11yViolations, openWindow, test } from "./fixtures";

/** First run on Windows and Linux (Wayland) through the mock `?os=` flag: no macOS copy. */
test.describe("onboarding off macOS", () => {
  test("Windows needs no permission and keeps everything on the computer", async ({ page }) => {
    await openWindow(page, "onboarding", "?os=windows");

    await expect(page.getByRole("heading", { name: "Know where your time goes" })).toBeVisible();
    await expect(page.getByText(/Everything stays on this computer/)).toBeVisible();
    await expect(page.getByText(/lives in your system tray/)).toBeVisible();
    await expect(page.getByText(/this Mac|Accessibility/)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Progress" })).toContainText("Recording");
    await expectNoA11yViolations(page);

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Choose what to record" })).toBeVisible();
    await expect(page.getByRole("region", { name: "No permission needed" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open System Settings" })).toHaveCount(0);
    await expectNoA11yViolations(page);

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "You're all set" })).toBeVisible();
    await expect(page.getByText("None needed")).toBeVisible();
    await expect(page.getByText(/turn on Open at login in Settings/)).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("Linux on Wayland explains that window tracking is unavailable", async ({ page }) => {
    await openWindow(page, "onboarding", "?os=linux&session=wayland");

    await expect(page.getByText(/Not available in a Wayland session/)).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByRole("button", { name: "Continue" }).click();
    const wayland = page.getByRole("region", { name: "Wayland session" });
    await expect(wayland.getByRole("heading", { name: "Window tracking is unavailable on Wayland" })).toBeVisible();
    await expect(wayland).toContainText("Ubuntu on Xorg");
    await expect(wayland).toContainText("Idle, lock and sleep detection");
    await expect(page.getByRole("button", { name: "Open System Settings" })).toHaveCount(0);
    await expectNoA11yViolations(page);

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Unavailable on Wayland")).toBeVisible();
    await expect(page.getByText(/needs the AppIndicator extension/)).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the popover shows the PC shortcut on Linux", async ({ page }) => {
    await openWindow(page, "popover", "?os=linux");
    await expect(page.getByTitle("Global shortcut")).toHaveText("Ctrl+Alt+Shift+K");
    await expectNoA11yViolations(page);
  });
});
