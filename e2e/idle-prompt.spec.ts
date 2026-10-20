import type { Page } from "@playwright/test";

import { expect, expectNoA11yViolations, openWindow, test } from "./fixtures";

// The seeded day has one pending 12 minute gap (12:43 - 12:55) after Slack.
const card = (page: Page) => page.getByRole("region", { name: "You were away" });

test.describe("idle prompt", () => {
  test("describes the gap and its last app", async ({ page }) => {
    await openWindow(page, "popover");

    await expect(card(page)).toContainText("You were away for 12m");
    await expect(card(page)).toContainText("last in Slack");
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

    await card(page).getByRole("button", { name: "Assign to previous app" }).click();

    await expect(card(page)).toHaveCount(0);
    await expect(page.getByTestId("today-total")).toHaveText("4:37:00");
  });

  test("assigning to a category adds the time and the card goes away", async ({ page }) => {
    await openWindow(page, "popover");

    await card(page).getByRole("button", { name: /^Assign to category/ }).click();
    await card(page).getByRole("list", { name: "Categories" }).getByRole("button", { name: "Meetings" }).click();

    await expect(card(page)).toHaveCount(0);
    await expect(page.getByTestId("today-total")).toHaveText("4:37:00");
  });
});

test("uses one clock format for the range and the expiry", async ({ page }) => {
  await openWindow(page, "popover");

  // en-US: no leading zero, same shape on both sides of the range and in the footer.
  await expect(card(page)).toContainText(/12:43\sPM – 12:55\sPM/);
  await expect(card(page)).toContainText(/discarded at [1-9]\d?:\d{2}\s[AP]M\./);
});
