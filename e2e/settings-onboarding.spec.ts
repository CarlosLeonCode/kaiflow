import { expect, expectNoA11yViolations, openSection, openWindow, test } from "./fixtures";

test.describe("Settings", () => {
  test("saves the theme immediately", async ({ page }) => {
    await openSection(page, "Settings");

    await page.getByRole("radio", { name: "Dark" }).click();

    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("checks for updates by hand and installs the one it finds", async ({ page }) => {
    await openWindow(page, "main", "?update=manual");
    await page.getByRole("navigation").getByRole("button", { name: /^Settings/ }).click();

    await page.getByRole("button", { name: "Check now for updates" }).click();
    await page.getByRole("button", { name: "Install and restart to version 0.2.0" }).click();

    await expect(page.getByRole("button", { name: "Installing update" })).toBeVisible();
  });

  test("has no accessibility violations", async ({ page }) => {
    await openSection(page, "Settings");
    await expect(page.getByRole("radio", { name: "Dark" })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

test.describe("Onboarding", () => {
  test("has no accessibility violations", async ({ page }) => {
    await openWindow(page, "onboarding", "?permission=denied");
    await expect(page.getByRole("heading").first()).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
