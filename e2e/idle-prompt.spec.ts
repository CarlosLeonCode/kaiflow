import type { Page } from "@playwright/test";

import { expect, expectNoA11yViolations, openWindow, test } from "./fixtures";

// The seeded day has one pending 12 minute gap (12:43 - 12:55) after Slack.
const card = (page: Page) => page.getByRole("region", { name: "You were away" });

test.describe("idle prompt", () => {
  test("describes the gap and its last app", async ({ page }) => {
    await openWindow(page, "popover");

    await expect(card(page)).toContainText("Away 12m");
    await expect(card(page)).toContainText("· Slack");
    await expect(card(page).getByRole("button", { name: "Keep" })).toHaveAttribute("title", "Count this time as Slack");
    await expectNoA11yViolations(page);
  });

  test("discarding removes the card and keeps the total", async ({ page }) => {
    await openWindow(page, "popover");
    await expect(page.getByTestId("today-total")).toHaveText("4:25:00");

    await card(page).getByRole("button", { name: "Discard" }).click();

    await expect(card(page)).toHaveCount(0);
    await expect(page.getByTestId("today-total")).toHaveText("4:25:00");
  });

  test("assigning to the previous app adds the time to today", async ({ page }) => {
    await openWindow(page, "popover");

    await card(page).getByRole("button", { name: "Keep" }).click();

    await expect(card(page)).toHaveCount(0);
    await expect(page.getByTestId("today-total")).toHaveText("4:37:00");
  });

  test("assigning to an activity adds the time and the card goes away", async ({ page }) => {
    await openWindow(page, "popover");

    await card(page).getByRole("button", { name: "Assign to an activity" }).click();
    await card(page).getByRole("list", { name: "Activities" }).getByRole("button", { name: "Meetings" }).click();

    await expect(card(page)).toHaveCount(0);
    await expect(page.getByTestId("today-total")).toHaveText("4:37:00");
  });
});

test("keeps the exact range in the heading's tooltip, in one clock format", async ({ page }) => {
  await openWindow(page, "popover");

  // en-US: no leading zero, same shape on both sides of the range.
  await expect(card(page).getByRole("heading")).toHaveAttribute("title", /^12:43\sPM – 12:55\sPM$/);
});

test("the popover shows the day before the away card", async ({ page }) => {
  await openWindow(page, "popover");

  const total = await page.getByTestId("today-total").boundingBox();
  const away = await card(page).boundingBox();
  expect(total && away && total.y < away.y).toBe(true);
});
