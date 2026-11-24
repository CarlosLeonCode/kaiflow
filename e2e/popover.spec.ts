import { expect, expectNoA11yViolations, openWindow, test } from "./fixtures";

test.describe("menu bar popover", () => {
  test("shows tracking status, today's total and the top apps", async ({ page }) => {
    await openWindow(page, "popover");

    await expect(page.getByText("Tracking", { exact: true })).toBeVisible();
    await expect(page.getByTestId("today-total")).toHaveText("4:25:00");
    await expect(page.getByText("Xcode").first()).toBeVisible();
  });

  test("pause and resume change the tracking state", async ({ page }) => {
    await openWindow(page, "popover");

    await page.getByRole("button", { name: /^Pause/ }).click();
    await expect(page.getByText("Paused", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /^Resume/ }).click();
    await expect(page.getByText("Tracking", { exact: true })).toBeVisible();
  });

  for (const language of ["en", "es"]) {
    test(`the footer fits the 360 px popover without overlap (${language})`, async ({ page }) => {
      await openWindow(page, "popover", `?language=${language}`);
      const footer = page.locator("footer");
      await expect(footer.getByRole("button").first()).toBeVisible();

      const fits = async () => {
        const boxes = await footer.locator(":scope > *").evaluateAll((items) =>
          items.map((item) => {
            const box = item.getBoundingClientRect();
            return { left: box.left, right: box.right, clipped: item.scrollWidth > Math.ceil(box.width) };
          }),
        );
        const edge = await footer.evaluate((el) => el.getBoundingClientRect().right);
        expect(boxes.every((box) => !box.clipped)).toBe(true);
        expect(boxes.every((box, i) => i === 0 || boxes[i - 1]!.right <= box.left)).toBe(true);
        expect(boxes.at(-1)!.right).toBeLessThanOrEqual(edge);
      };

      await fits();
      // Paused, the toggle reads "Resume tracking" / "Reanudar registro", the longest label.
      await footer.getByRole("button").first().click();
      await expect(footer.getByRole("button").first()).toHaveText(/Resume|Reanudar/);
      await fits();
    });
  }

  test("announces an available update and installs it on request", async ({ page }) => {
    await openWindow(page, "popover", "?update=1");

    await expect(page.getByText("Version 0.2.0 is available")).toBeVisible();
    await page.getByRole("button", { name: "Install and restart" }).click();
    await expect(page.getByText("Installing. The app will restart in a moment.")).toBeVisible();
  });

  test("has no accessibility violations", async ({ page }) => {
    await openWindow(page, "popover", "?update=1");
    await expect(page.getByTestId("today-total")).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
