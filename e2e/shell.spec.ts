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
  test("the sidebar highlight always matches the rendered section", async ({ page }) => {
    await openWindow(page, "main");
    const steps: [() => Promise<void>, string][] = [
      [() => nav(page).getByRole("button", { name: /^Categories/ }).click(), "Categories"],
      [() => nav(page).getByRole("button", { name: /^History/ }).click(), "History"],
      [() => page.keyboard.press("Meta+3"), "Categories"],
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
