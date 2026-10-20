import { expect, expectNoA11yViolations, openSection, test } from "./fixtures";

test.describe("Today", () => {
  test("shows the focused total, the timeline and the breakdowns", async ({ page }) => {
    await openSection(page, "Today");

    await expect(page.getByTestId("today-total")).toHaveText("4:25:00");
    await expect(page.getByRole("img", { name: /timeline/i }).first()).toBeVisible();

    const byApp = page.getByRole("list", { name: "Time by app" });
    await expect(byApp.getByRole("listitem").first()).toContainText("Xcode");
    await expect(byApp.getByRole("listitem").first()).toContainText("2h 45m");

    const byCategory = page.getByRole("list", { name: "Time by category" });
    await expect(byCategory).toContainText("Development");
    await expect(byCategory).toContainText("Meetings");
    await expect(byCategory).toContainText("Uncategorized");
  });

  test("expands an app to its window titles", async ({ page }) => {
    await openSection(page, "Today");

    await page.getByRole("list", { name: "Time by app" }).getByRole("button", { name: /Xcode/ }).click();

    await expect(page.getByRole("list", { name: "Window titles in Xcode" })).toContainText("TimeTrackApp.swift");
  });

  test("has no accessibility violations", async ({ page }) => {
    await openSection(page, "Today");
    await expect(page.getByTestId("today-total")).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
