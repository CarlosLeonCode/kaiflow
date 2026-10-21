import type { Page } from "@playwright/test";

import { expect, openWindow, test } from "./fixtures";

const nav = (page: Page) => page.getByRole("navigation", { name: "Sections" });

/** The highlighted item, read in the same task as the action (no auto-wait). */
async function highlightNow(page: Page): Promise<{ current: string[]; animating: number }> {
  return nav(page).evaluate((element) => {
    const buttons = [...element.querySelectorAll("button")];
    return {
      current: buttons
        .filter((button) => button.getAttribute("aria-current") === "page")
        .map((button) => button.textContent?.replace(/⌘\d/, "") ?? ""),
      animating: buttons.reduce((count, button) => count + button.getAnimations().length, 0),
    };
  });
}

test.describe("main window shell", () => {
  test("a dismissed section intro stays dismissed and does not affect other sections", async ({ page }) => {
    await openWindow(page, "main");
    const todayIntro = page.getByRole("complementary", { name: "About Your day at a glance" });
    await expect(todayIntro).toBeVisible();
    await todayIntro.getByRole("button", { name: /^Dismiss introduction/ }).click();
    await expect(todayIntro).toHaveCount(0);

    await nav(page).getByRole("button", { name: /^Activities/ }).click();
    await expect(page.getByRole("complementary", { name: "About Organize time into activities" })).toBeVisible();
    await nav(page).getByRole("button", { name: /^Today/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await expect(todayIntro).toHaveCount(0);
  });

  test("the sidebar highlight always matches the rendered section", async ({ page }) => {
    await openWindow(page, "main");
    const steps: [() => Promise<void>, string][] = [
      [() => nav(page).getByRole("button", { name: /^Activities/ }).click(), "Activities"],
      [() => nav(page).getByRole("button", { name: /^Overview/ }).click(), "Overview"],
      [() => page.keyboard.press("Meta+6"), "Activities"],
      [() => page.keyboard.press("Meta+1"), "Today"],
    ];

    for (const [act, name] of steps) {
      await act();
      await expect(page.getByRole("main").getByRole("heading", { level: 1, name })).toBeVisible();
      // No color transition in flight: the highlight is already final when the section shows.
      expect(await highlightNow(page)).toEqual({ current: [name], animating: 0 });
      await expect(nav(page).getByRole("button", { name: new RegExp(`^${name}`) })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
  });
});
