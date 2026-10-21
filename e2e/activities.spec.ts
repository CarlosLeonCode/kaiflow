import { expect, expectNoA11yViolations, openSection, test } from "./fixtures";

test.describe("Activities", () => {
  test("creates an activity and lists it", async ({ page }) => {
    await openSection(page, "Activities");

    await page.getByRole("button", { name: "New activity" }).click();
    await page.getByLabel("Name").fill("Deep work");
    await page.getByRole("button", { name: "Add activity" }).click();

    const list = page.getByRole("list", { name: "Activity list" });
    await expect(list).toContainText("Deep work");
    await expect(list).toContainText("No rules");
  });

  test("creates an activity with a productivity flag", async ({ page }) => {
    await openSection(page, "Activities");

    await page.getByRole("button", { name: "New activity" }).click();
    await page.getByLabel("Name").fill("Scrolling");
    await page.getByRole("radio", { name: "Distracting" }).click();
    await page.getByRole("button", { name: "Add activity" }).click();

    await expect(page.getByRole("list", { name: "Activity list" })).toContainText("Scrolling");
    await expect(page.getByRole("list", { name: "Activity list" })).toContainText("Distracting");
  });

  test("rejects a duplicate name without saving", async ({ page }) => {
    await openSection(page, "Activities");

    await page.getByRole("button", { name: "New activity" }).click();
    await page.getByLabel("Name").fill("development");
    await page.getByRole("button", { name: "Add activity" }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("list", { name: "Activity list" }).getByText("Development")).toHaveCount(1);
  });

  test("renames an activity", async ({ page }) => {
    await openSection(page, "Activities");

    await page.getByRole("button", { name: "Edit Meetings" }).click();
    await page.getByLabel("Name").fill("Calls");
    await page.getByRole("button", { name: "Save" }).click();

    const list = page.getByRole("list", { name: "Activity list" });
    await expect(list).toContainText("Calls");
    await expect(list).not.toContainText("Meetings");
  });

  test("deletes an activity only after confirming, and says what happens to its time", async ({ page }) => {
    await openSection(page, "Activities");

    await page.getByRole("button", { name: "Delete Meetings" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Time already tracked in this activity moves to Unassigned.");
    await expect(dialog).toContainText("rule is deleted too");

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("list", { name: "Activity list" })).toContainText("Meetings");

    await page.getByRole("button", { name: "Delete Meetings" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete activity" }).click();
    await expect(page.getByRole("list", { name: "Activity list" })).not.toContainText("Meetings");

    // The 30 minutes of zoom.us now count as Unassigned on Today.
    await page.getByRole("navigation").getByRole("button", { name: /^Today/ }).click();
    await expect(page.getByRole("list", { name: "Time by activity" })).not.toContainText("Meetings");
  });

  test("adds a title rule and shows a backend pattern error inline", async ({ page }) => {
    await openSection(page, "Activities");

    const form = page.getByRole("form", { name: "Add rule" });
    await form.getByRole("radio", { name: "Window title" }).click();
    await form.getByLabel("Title pattern").fill("(unclosed");
    await form.getByLabel("Activity").selectOption({ label: "Development" });
    await form.getByRole("button", { name: "Add rule" }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    await expect(form.getByLabel("Title pattern")).toHaveAttribute("aria-invalid", "true");

    await form.getByLabel("Title pattern").fill("Tauri");
    await form.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByText("/Tauri/")).toBeVisible();
  });

  test("has no accessibility violations", async ({ page }) => {
    await openSection(page, "Activities");
    await expect(page.getByRole("list", { name: "Activity list" })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
