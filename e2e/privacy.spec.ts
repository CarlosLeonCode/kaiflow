import { expect, expectNoA11yViolations, openSection, test } from "./fixtures";

test.describe("Privacy", () => {
  test("asks for confirmation and keeps everything when cancelled", async ({ page }) => {
    await openSection(page, "Privacy");

    await page.getByRole("button", { name: "Delete all data…" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    // Focus starts on Cancel so a stray Enter never deletes anything.
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("All tracked data was deleted.")).toHaveCount(0);
  });

  test("deleting a date range needs the confirmation and reports the result", async ({ page }) => {
    await openSection(page, "Privacy");

    await page.getByLabel("From", { exact: true }).fill("2026-03-17");
    await page.getByLabel("To", { exact: true }).fill("2026-03-17");
    await page.getByRole("button", { name: "Delete range…" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: /^Delete/ }).last().click();

    await expect(page.getByText(/Deleted \d+ segments/)).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("adds an app rule that hides its window titles", async ({ page }) => {
    await openSection(page, "Privacy");

    const form = page.getByRole("form", { name: "Add app rule" });
    await form.getByLabel(/App/).first().fill("com.apple.mail");
    await form.getByRole("radio", { name: "Hide titles" }).click();
    await form.getByRole("button", { name: /^Add/ }).click();

    await expect(page.getByRole("list", { name: "App privacy rules" })).toContainText("com.apple.mail");
  });

  test("has no accessibility violations", async ({ page }) => {
    await openSection(page, "Privacy");
    await expect(page.getByRole("button", { name: "Delete all data…" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("has no accessibility violations with the confirmation open", async ({ page }) => {
    await openSection(page, "Privacy");
    await page.getByRole("button", { name: "Delete all data…" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
