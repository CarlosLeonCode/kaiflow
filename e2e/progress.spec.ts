import type { Page } from "@playwright/test";

import { expect, expectNoA11yViolations, openSection, openWindow, test } from "./fixtures";

const SEAL = "New seal: Ten sessions";

async function expectNoA11yViolationsInBothThemes(page: Page): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveClass(colorScheme === "dark" ? /dark/ : /^(?!.*dark)/);
    // Colors transition on a theme switch: let them settle before checking contrast.
    await page.evaluate(() =>
      Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished)),
    );
    await expectNoA11yViolations(page);
  }
}

test.describe("progress", () => {
  test("the popover shows the strokes chip, Kai and the moment until it is dismissed", async ({ page }) => {
    await openWindow(page, "popover");

    const chip = page.getByRole("button", { name: "+35 today, open Goals" });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAccessibleDescription("35 of 100 strokes today");
    await expect(page.locator("svg[data-pose]")).toHaveAttribute("data-pose", "hello");
    const card = page.getByRole("region", { name: SEAL });
    await expect(card).toContainText("Ten focus sessions finished.");
    await expect(card.getByRole("button", { name: "See your seals" })).toBeVisible();

    await expectNoA11yViolationsInBothThemes(page);

    await card.getByRole("button", { name: `Dismiss: ${SEAL}` }).click();
    await expect(page.getByRole("region", { name: SEAL })).toHaveCount(0);
    await expect(chip).toBeVisible();
  });

  test("Kai rests during a break and celebrates a full ensō", async ({ page }) => {
    await openWindow(page, "popover", "?focus=break");
    await expect(page.locator("svg[data-pose]")).toHaveAttribute("data-pose", "rest");

    await openWindow(page, "popover", "?progress=done");
    await expect(page.locator("svg[data-pose]")).toHaveAttribute("data-pose", "done");
    await expect(page.getByRole("button", { name: "Done today, open Goals" })).toHaveAccessibleDescription(
      "Today's ensō is done",
    );
    await expect(page.getByRole("region", { name: "Today's ensō is done" })).toBeVisible();
  });

  test("Goals shows the level, the streak, the ledger and the seals", async ({ page }) => {
    await openSection(page, "Goals");

    const panel = page.getByRole("region", { name: "Progress" });
    await expect(panel.getByRole("img", { name: "35 of 100 strokes today" })).toBeVisible();
    await expect(panel.getByRole("img", { name: "Level 4, Flow: 410 of 2,000 strokes to Craft" })).toBeVisible();
    await expect(panel.getByText("5-day streak")).toBeVisible();
    const ledger = panel.getByRole("list", { name: "How today's strokes were earned" });
    await expect(ledger).toContainText("Focus sessions");
    await expect(ledger).toContainText("Stayed on target");
    const seals = panel.getByRole("list", { name: "Seals" });
    await expect(seals.getByRole("img", { name: "Ten sessions, new" })).toBeVisible();
    await expect(seals.getByRole("img", { name: "Thirty days, not earned yet" })).toBeVisible();
    await expect(panel.getByRole("region", { name: SEAL })).toBeVisible();

    await expectNoA11yViolationsInBothThemes(page);

    await panel.getByRole("button", { name: "See your seals" }).click();
    await expect(seals).toBeInViewport();
    await panel.getByRole("button", { name: `Dismiss: ${SEAL}` }).click();
    await expect(panel.getByRole("region", { name: SEAL })).toHaveCount(0);
    await expect(seals.getByRole("img", { name: "Ten sessions, earned" })).toBeVisible();
  });

  test("the main window opens on Goals with the panel in view when the popover asks", async ({ page }) => {
    // `?section=goals` seeds the request the popover's strokes chip makes (each mocked window
    // has its own backend).
    await openWindow(page, "main", "?section=goals&goals=demo");

    await expect(page.getByRole("heading", { level: 1, name: "Goals" })).toBeVisible();
    const panel = page.getByRole("region", { name: "Progress" });
    await expect(panel).toBeVisible();
    // Scrolled past the section intro: the panel starts right under the page header.
    await expect.poll(async () => (await panel.boundingBox())?.y ?? Infinity).toBeLessThan(120);
    // Taken once: the sidebar rules from here on.
    await page.getByRole("navigation").getByRole("button", { name: /^Today/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  });

  test("the Settings toggle hides progress, and the popover hides the chip while it is off", async ({ page }) => {
    await openSection(page, "Settings");

    const toggle = page.getByRole("switch", { name: "Strokes, levels and seals" });
    await expect(toggle).toBeChecked();
    await expectNoA11yViolationsInBothThemes(page);
    await toggle.click();
    await expect(toggle).not.toBeChecked();

    await page.getByRole("navigation").getByRole("button", { name: /^Goals/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Goals" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Progress" })).toHaveCount(0);

    // Each mocked window has its own backend: the stored setting is off from the start here.
    await openWindow(page, "popover", "?progress=off");
    await expect(page.getByTestId("today-total")).toBeVisible();
    await expect(page.getByRole("button", { name: /strokes today/ })).toHaveCount(0);
    await expect(page.locator("svg[data-pose]")).toHaveCount(0);
    await expect(page.getByRole("region", { name: SEAL })).toHaveCount(0);
  });

  test("onboarding greets with Kai even while progress is off", async ({ page }) => {
    await openWindow(page, "onboarding", "?progress=off");

    await expect(page.getByRole("img", { name: "Kai waving, holding the vermilion dot" })).toBeVisible();
    await expectNoA11yViolationsInBothThemes(page);
  });
});
