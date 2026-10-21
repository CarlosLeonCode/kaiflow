import { expect, expectNoA11yViolations, openSection, openWindow, test } from "./fixtures";

test.describe("Settings", () => {
  test("saves the theme immediately", async ({ page }) => {
    await openSection(page, "Settings");

    await page.getByRole("radio", { name: "Dark" }).click();

    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("lets you change the idle behavior", async ({ page }) => {
    await openSection(page, "Settings");

    const limit = page.getByRole("combobox", { name: "Skip the prompt for short breaks" });
    await expect(limit).toHaveValue("120");
    await limit.selectOption({ label: "Always ask" });
    await expect(limit).toHaveValue("0");
    await page.getByRole("combobox", { name: "Answer the prompt within" }).selectOption({ label: "5 min" });
    await expect(page.getByRole("combobox", { name: "Answer the prompt within" })).toHaveValue("300");
  });

  test("checks for updates by hand and installs the one it finds", async ({ page }) => {
    await openWindow(page, "main", "?update=manual");
    await page.getByRole("navigation").getByRole("button", { name: /^Settings/ }).click();

    await page.getByRole("button", { name: "Check now for updates" }).click();
    await page.getByRole("button", { name: "Install and restart to version 0.2.0" }).click();

    await expect(page.getByRole("button", { name: "Installing update" })).toBeVisible();
  });

  test("shows the version, license and source code in About", async ({ page }) => {
    await openSection(page, "Settings");
    const about = page.getByRole("region", { name: "About" });
    await about.scrollIntoViewIfNeeded();
    await expect(about.getByText("MIT", { exact: true })).toBeVisible();
    await expect(about.getByText(/^\d+\.\d+\.\d+/)).toBeVisible();
    await expect(about.getByText("https://github.com/CarlosLeonCode/kaiflow", { exact: true })).toBeVisible();
  });

  test("has no accessibility violations", async ({ page }) => {
    await openSection(page, "Settings");
    await expect(page.getByRole("radio", { name: "Dark" })).toBeVisible();
    await page.getByRole("region", { name: "About" }).scrollIntoViewIfNeeded();
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
