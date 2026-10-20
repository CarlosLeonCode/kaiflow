import { expect, expectNoA11yViolations, openSection, test } from "./fixtures";

test.describe("History", () => {
  test("opens on the current week with a summary and a chart", async ({ page }) => {
    await openSection(page, "History");

    await expect(page.getByText("Mar 16 – 22, 2026")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next week" })).toBeDisabled();
    await expect(page.getByRole("group").filter({ has: page.getByRole("img") }).first()).toBeVisible();
  });

  test("goes back through weeks and returns to today", async ({ page }) => {
    await openSection(page, "History");

    await page.getByRole("button", { name: "Previous week" }).click();
    await expect(page.getByText("Mar 9 – 15, 2026")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next week" })).toBeEnabled();

    await page.getByRole("main").getByRole("button", { name: "Today" }).click();
    await expect(page.getByText("Mar 16 – 22, 2026")).toBeVisible();
  });

  test("switches between day, week and month", async ({ page }) => {
    await openSection(page, "History");

    await page.getByRole("radio", { name: "Day" }).click();
    await expect(page.getByText("Wednesday, March 18, 2026").first()).toBeVisible();
    await page.getByRole("button", { name: "Previous day" }).click();
    await expect(page.getByText("Tuesday, March 17, 2026").first()).toBeVisible();

    await page.getByRole("radio", { name: "Month" }).click();
    await expect(page.getByText("March 2026").first()).toBeVisible();
    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(page.getByText("February 2026").first()).toBeVisible();
  });

  test("exports the visible range and reports where it was saved", async ({ page }) => {
    await openSection(page, "History");

    await page.getByRole("button", { name: "Export CSV" }).click();

    await expect(page.getByText("/Users/demo/Downloads/time-track.csv")).toBeVisible();
  });

  test("has no accessibility violations", async ({ page }) => {
    await openSection(page, "History");
    await expect(page.getByText("Mar 16 – 22, 2026")).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
