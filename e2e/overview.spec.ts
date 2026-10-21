import type { Page } from "@playwright/test";

import { expect, expectNoA11yViolations, openSection, openWindow, test } from "./fixtures";

/** Every IPC command the mocked backend has served so far, in order. */
async function calls(page: Page): Promise<string[]> {
  return page.evaluate(() => [...((globalThis as { __mockIpcCalls?: string[] }).__mockIpcCalls ?? [])]);
}

const count = (log: string[], cmd: string) => log.filter((entry) => entry === cmd).length;

test.describe("Overview", () => {
  test("opens on the current week with the summary and every chart", async ({ page }) => {
    await openSection(page, "Overview");

    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByText("Mar 16 – 22, 2026")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next week" })).toBeDisabled();
    await expect(page.getByRole("group", { name: "Tracked time per day, stacked by activity" })).toBeVisible();
    await expect(page.getByRole("grid", { name: "Tracked time by weekday and hour" })).toBeVisible();
    await expect(page.getByRole("img", { name: /^Tracked time per day\. 3 points/ })).toBeVisible();
    await expect(page.getByTestId("focus-ratio")).toBeVisible();
    await expect(page.getByTestId("overview-comparison")).toContainText(/previous week/);
    await expect(page.getByRole("list", { name: "Time by window title" })).toBeVisible();
  });

  test("goes back through weeks and returns to today", async ({ page }) => {
    await openSection(page, "Overview");

    await page.getByRole("button", { name: "Previous week" }).click();
    await expect(page.getByText("Mar 9 – 15, 2026")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next week" })).toBeEnabled();

    await page.getByRole("main").getByRole("button", { name: "Today" }).click();
    await expect(page.getByText("Mar 16 – 22, 2026")).toBeVisible();
  });

  test("switches between day, week, month and 90 days", async ({ page }) => {
    await openSection(page, "Overview");

    await page.getByRole("radio", { name: "Day", exact: true }).click();
    await expect(page.getByText("Wednesday, March 18, 2026").first()).toBeVisible();
    await expect(page.getByRole("group", { name: "Tracked time per hour, stacked by activity" })).toBeVisible();
    // The weekday heatmap makes no sense for a single day.
    await expect(page.getByRole("grid")).toHaveCount(0);
    await page.getByRole("button", { name: "Previous day" }).click();
    await expect(page.getByText("Tuesday, March 17, 2026").first()).toBeVisible();

    await page.getByRole("radio", { name: "Month" }).click();
    await expect(page.getByText("March 2026").first()).toBeVisible();
    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(page.getByText("February 2026").first()).toBeVisible();

    // Switching keeps the period being looked at: jump back to the present first.
    await page.getByRole("main").getByRole("button", { name: "Today" }).click();
    await page.getByRole("radio", { name: "90 days" }).click();
    await expect(page.getByText(/Dec 19, 2025\s*[–-]\s*Mar 18, 2026/)).toBeVisible();
    await expect(page.getByRole("group", { name: "Tracked time per week, stacked by activity" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next 90 days" })).toBeDisabled();
    await page.getByRole("button", { name: "Previous 90 days" }).click();
    await expect(page.getByRole("button", { name: "Next 90 days" })).toBeEnabled();
  });

  test("a month costs exactly one dashboard call, never one per day", async ({ page }) => {
    await openSection(page, "Overview");
    await expect(page.getByText("Mar 16 – 22, 2026")).toBeVisible();
    const before = await calls(page);
    expect(count(before, "get_dashboard")).toBe(1);

    await page.getByRole("radio", { name: "Month" }).click();
    await expect(page.getByText("March 2026").first()).toBeVisible();
    await expect(page.getByRole("img", { name: /^Tracked time per day\. 18 points/ })).toBeVisible();

    const after = await calls(page);
    expect(count(after, "get_dashboard") - count(before, "get_dashboard")).toBe(1);
    // Opening the Overview and the month view added no per-day report at all.
    expect(count(after, "get_report")).toBe(count(before, "get_report"));
  });

  test("exports the visible range and reports where it was saved", async ({ page }) => {
    await openSection(page, "Overview");

    await page.getByRole("button", { name: "Export JSON" }).click();

    await expect(page.getByText("/Users/demo/Downloads/kaiflow-export.json")).toBeVisible();
  });

  test("explains an empty history and offers a way forward", async ({ page }) => {
    await openWindow(page, "main", "?data=empty");
    await page.getByRole("navigation").getByRole("button", { name: /^Overview/ }).click();

    await expect(page.getByRole("heading", { name: "Nothing tracked this week" })).toBeVisible();
    await expect(page.getByTestId("overview-comparison")).toContainText("No comparison");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Previous week" })).toBeEnabled();
    await expectNoA11yViolations(page);
  });

  test("has no accessibility violations in light and dark", async ({ page }) => {
    await openSection(page, "Overview");
    await expect(page.getByText("Mar 16 – 22, 2026")).toBeVisible();
    await expectNoA11yViolations(page);

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expectNoA11yViolations(page);

    await page.getByRole("radio", { name: "90 days" }).click();
    await expect(page.getByText(/Dec 19, 2025/)).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

test("y-axis labels are compact and stay on one line", async ({ page }) => {
  await openSection(page, "Overview");
  await expect(page.getByText("Mar 16 – 22, 2026")).toBeVisible();

  const labels = page.getByTestId("chart-y-axis").locator("span");
  for (const label of await labels.all()) {
    await expect(label).toHaveText(/^(0|\d+h( \d+m)?|\d+m( \d+s)?|\d+s)$/);
    const lines = await label.evaluate((el) => el.getClientRects().length);
    const box = await label.evaluate((el) => ({ h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight) }));
    expect(lines).toBe(1);
    expect(box.h).toBeLessThanOrEqual(box.lh + 1);
  }
});
