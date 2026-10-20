import { expect, expectNoA11yViolations, openSection, test } from "./fixtures";

test.describe("Categories", () => {
  test("creates a category and lists it", async ({ page }) => {
    await openSection(page, "Categories");

    await page.getByRole("button", { name: "New category" }).click();
    await page.getByLabel("Name").fill("Deep work");
    await page.getByRole("button", { name: "Add category" }).click();

    const list = page.getByRole("list", { name: "Category list" });
    await expect(list).toContainText("Deep work");
    await expect(list).toContainText("No rules");
  });

  test("rejects a duplicate name without saving", async ({ page }) => {
    await openSection(page, "Categories");

    await page.getByRole("button", { name: "New category" }).click();
    await page.getByLabel("Name").fill("development");
    await page.getByRole("button", { name: "Add category" }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("list", { name: "Category list" }).getByText("Development")).toHaveCount(1);
  });

  test("renames a category", async ({ page }) => {
    await openSection(page, "Categories");

    await page.getByRole("button", { name: "Edit Meetings" }).click();
    await page.getByLabel("Name").fill("Calls");
    await page.getByRole("button", { name: "Save" }).click();

    const list = page.getByRole("list", { name: "Category list" });
    await expect(list).toContainText("Calls");
    await expect(list).not.toContainText("Meetings");
  });

  test("deletes a category only after confirming, and says what happens to its time", async ({ page }) => {
    await openSection(page, "Categories");

    await page.getByRole("button", { name: "Delete Meetings" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Time already tracked in this category moves to Uncategorized.");
    await expect(dialog).toContainText("rule is deleted too");

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("list", { name: "Category list" })).toContainText("Meetings");

    await page.getByRole("button", { name: "Delete Meetings" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete category" }).click();
    await expect(page.getByRole("list", { name: "Category list" })).not.toContainText("Meetings");

    // The 30 minutes of zoom.us now count as Uncategorized on Today.
    await page.getByRole("navigation").getByRole("button", { name: /^Today/ }).click();
    await expect(page.getByRole("list", { name: "Time by category" })).not.toContainText("Meetings");
  });

  test("adds a title rule and shows a backend pattern error inline", async ({ page }) => {
    await openSection(page, "Categories");

    const form = page.getByRole("form", { name: "Add rule" });
    await form.getByRole("radio", { name: "Window title" }).click();
    await form.getByLabel("Title pattern").fill("(unclosed");
    await form.getByLabel("Category").selectOption({ label: "Development" });
    await form.getByRole("button", { name: "Add rule" }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    await expect(form.getByLabel("Title pattern")).toHaveAttribute("aria-invalid", "true");

    await form.getByLabel("Title pattern").fill("Tauri");
    await form.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByText("/Tauri/")).toBeVisible();
  });

  test("has no accessibility violations", async ({ page }) => {
    await openSection(page, "Categories");
    await expect(page.getByRole("list", { name: "Category list" })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
