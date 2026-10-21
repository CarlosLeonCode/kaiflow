import type { Page } from "@playwright/test";

import { expect, expectNoA11yViolations, openSection, openWindow, test } from "./fixtures";

/** The dashboard with only the system activity and no rules: the first-run state. */
async function openFreshActivities(page: Page): Promise<void> {
  await openWindow(page, "main", "?activities=empty");
  await page.getByRole("navigation").getByRole("button", { name: /^Activities/ }).click();
}

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

  test("starts empty with the same weight as a pack and creates nothing", async ({ page }) => {
    await openFreshActivities(page);

    const options = page.getByRole("list", { name: "Ways to start" });
    await expect(options.getByRole("button", { name: "Preview the Design pack" })).toBeVisible();
    await expect(options.getByRole("button", { name: "Start empty" })).toBeVisible();
    await expect(options.getByRole("radio")).toHaveCount(0);

    await options.getByRole("button", { name: "Start empty" }).click();
    await expect(options).toHaveCount(0);
    // Only the system activity exists and the app is usable.
    await expect(page.getByRole("list", { name: "Activity list" }).getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Create your first activity" })).toBeVisible();

    // The choice survives a reload (it is persisted by the backend; the mock keeps it in memory,
    // so check within the session by switching sections).
    await page.getByRole("navigation").getByRole("button", { name: /^Today/ }).click();
    await page.getByRole("navigation").getByRole("button", { name: /^Activities/ }).click();
    await expect(page.getByRole("list", { name: "Ways to start" })).toHaveCount(0);
  });

  test("previews a pack, applies it and files the apps already used", async ({ page }) => {
    await openFreshActivities(page);

    await page.getByRole("button", { name: "Preview the Development pack" }).click();
    const preview = page.getByRole("list", { name: "Activities in the Development pack" });
    await expect(preview).toContainText("Coding");
    await expect(page.getByRole("list", { name: "Activity list" }).getByRole("listitem")).toHaveCount(1);

    await page.getByRole("button", { name: "Add Development activities" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Development: added 2 activities" })).toBeVisible();
    const list = page.getByRole("list", { name: "Activity list" });
    await expect(list).toContainText("Coding");
    await expect(list).toContainText("Terminal");
    // Xcode was already in the history, so Coding got a rule for it.
    await expect(list.getByRole("listitem").filter({ hasText: "Coding" })).toContainText("1 rule");
    await expect(page.getByRole("list", { name: "Ways to start" })).toHaveCount(0);
  });

  test("accepts a suggestion: the rule is created and past time is reclassified", async ({ page }) => {
    await openSection(page, "Activities");

    const suggestions = page.getByRole("list", { name: "Suggestion list" });
    await expect(suggestions).toContainText("Safari");
    await expect(suggestions).toContainText("Browsing");

    await page.getByRole("button", { name: "Accept Safari as Browsing" }).click();
    await expect(suggestions).not.toContainText("Safari");
    await expect(page.getByRole("list", { name: "Activity list" })).toContainText("Browsing");

    await page.getByRole("navigation").getByRole("button", { name: /^Today/ }).click();
    await expect(page.getByRole("list", { name: "Time by activity" })).toContainText("Browsing");
  });

  test("dismisses a suggestion for good without creating a rule", async ({ page }) => {
    await openSection(page, "Activities");

    await page.getByRole("button", { name: "Dismiss suggestion for Safari" }).click();
    await expect(page.getByRole("list", { name: "Suggestion list" })).not.toContainText("Safari");
    await expect(page.getByRole("list", { name: "Activity list" })).not.toContainText("Browsing");

    await page.getByRole("navigation").getByRole("button", { name: /^Today/ }).click();
    await page.getByRole("navigation").getByRole("button", { name: /^Activities/ }).click();
    await expect(page.getByRole("list", { name: "Suggestion list" })).not.toContainText("Safari");
  });

  test("the first-run choice has no accessibility violations", async ({ page }) => {
    await openFreshActivities(page);
    await expect(page.getByRole("list", { name: "Ways to start" })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
