import type { Page } from "@playwright/test";

import { expect, expectNoA11yViolations, openWindow, test } from "./fixtures";

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
  test("the sidebar groups the seven sections under Daily, Look back and Setup", async ({ page }) => {
    await openWindow(page, "main");
    const groups: [string, string[]][] = [
      ["Daily", ["Today", "Focus", "Goals"]],
      ["Look back", ["Insights"]],
      ["Setup", ["Activities", "Privacy", "Settings"]],
    ];
    for (const [group, sections] of groups) {
      const buttons = nav(page).getByRole("group", { name: group }).getByRole("button");
      await expect(buttons).toHaveCount(sections.length);
      for (const [index, name] of sections.entries()) {
        await expect(buttons.nth(index)).toHaveText(new RegExp(`^${name}`));
      }
    }
    await expectNoA11yViolations(page);
  });

  test("only macOS reserves a title strip and drag regions for its overlay title bar", async ({ page }) => {
    await openWindow(page, "main");
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await expect(page.locator("header[data-tauri-drag-region]")).toHaveCount(1);
    await expect(page.getByTestId("title-bar-strip")).toHaveCount(1);

    // Windows and Linux draw a native title bar: no empty strip, and the header does not drag.
    await openWindow(page, "main", "?os=windows");
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await expect(page.getByTestId("title-bar-strip")).toHaveCount(0);
    await expect(page.locator("[data-tauri-drag-region]")).toHaveCount(0);
  });

  test("a dismissed section intro stays dismissed and does not affect other sections", async ({ page }) => {
    await openWindow(page, "main");
    const todayIntro = page.getByRole("complementary", { name: "About Your day so far" });
    await expect(todayIntro).toBeVisible();
    await todayIntro.getByRole("button", { name: /^Dismiss introduction/ }).click();
    await expect(todayIntro).toHaveCount(0);

    await nav(page).getByRole("button", { name: /^Activities/ }).click();
    await expect(page.getByRole("complementary", { name: "About What activities are for" })).toBeVisible();
    await nav(page).getByRole("button", { name: /^Today/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await expect(todayIntro).toHaveCount(0);
  });

  test("the help button reopens a dismissed intro in every section", async ({ page }) => {
    await openWindow(page, "main");
    for (const name of ["Today", "Focus", "Goals", "Insights", "Activities", "Privacy", "Settings"]) {
      await nav(page).getByRole("button", { name: new RegExp(`^${name}`) }).click();
      const main = page.getByRole("main");
      const intro = main.getByRole("complementary", { name: /^About / });
      await expect(intro).toBeVisible();
      await expect(intro).toContainText("What this is");
      await expect(intro).toContainText("What you can do here");
      await expect(intro).toContainText("Example");

      await intro.getByRole("button", { name: /^Dismiss introduction/ }).click();
      await expect(intro).toHaveCount(0);
      const help = main.getByRole("button", { name: `Help for ${name}` });
      await expect(help).toBeFocused();
      await expect(help).toHaveAttribute("aria-expanded", "false");

      await page.keyboard.press("Enter");
      await expect(intro).toBeFocused();
      await expect(help).toHaveAttribute("aria-expanded", "true");
    }
  });

  test("intros and help buttons have no accessibility violations in dark mode", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openWindow(page, "main");
    for (const name of ["Today", "Activities", "Settings"]) {
      await nav(page).getByRole("button", { name: new RegExp(`^${name}`) }).click();
      await expect(page.getByRole("main").getByRole("complementary", { name: /^About / })).toBeVisible();
      await expectNoA11yViolations(page);
    }
  });

  test("the sidebar highlight always matches the rendered section", async ({ page }) => {
    await openWindow(page, "main");
    const steps: [() => Promise<void>, string][] = [
      [() => nav(page).getByRole("button", { name: /^Activities/ }).click(), "Activities"],
      [() => nav(page).getByRole("button", { name: /^Insights/ }).click(), "Insights"],
      [() => page.keyboard.press("Meta+5"), "Activities"],
      [() => page.keyboard.press("Meta+4"), "Insights"],
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
