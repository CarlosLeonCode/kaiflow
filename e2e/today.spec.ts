import { expect, expectNoA11yViolations, openSection, test } from "./fixtures";

test.describe("Today", () => {
  test("shows the focused total, the timeline and the breakdowns", async ({ page }) => {
    await openSection(page, "Today");

    await expect(page.getByTestId("today-total")).toHaveText("4:25:00");
    await expect(page.getByRole("img", { name: /timeline/i }).first()).toBeVisible();

    const byApp = page.getByRole("list", { name: "Time by app" });
    await expect(byApp.getByRole("listitem").first()).toContainText("Xcode");
    await expect(byApp.getByRole("listitem").first()).toContainText("2h 45m");

    const byActivity = page.getByRole("list", { name: "Time by activity" });
    await expect(byActivity).toContainText("Development");
    await expect(byActivity).toContainText("Meetings");
    await expect(byActivity).toContainText("Unassigned");
  });

  test("mentions the short breaks discarded without asking", async ({ page }) => {
    await openSection(page, "Today");

    await expect(page.getByTestId("auto-discarded-hint")).toContainText("2 short breaks discarded today");
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

test("timeline tick labels stay on one line inside the axis", async ({ page }) => {
  await openSection(page, "Today");
  const axis = page.getByTestId("timeline-axis");
  await expect(axis.locator("span").first()).toBeVisible();

  const result = await axis.evaluate((el) => {
    const bounds = el.getBoundingClientRect();
    return [...el.querySelectorAll("span")].map((span) => {
      const box = span.getBoundingClientRect();
      return {
        text: span.textContent,
        singleLine: box.height <= parseFloat(getComputedStyle(span).lineHeight) + 1,
        inside: box.left >= bounds.left - 0.5 && box.right <= bounds.right + 0.5,
      };
    });
  });
  for (const tick of result) expect(tick, tick.text ?? "").toMatchObject({ singleLine: true, inside: true });
});
