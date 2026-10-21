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
    await form.getByRole("radio", { name: "Pattern (advanced)" }).click();
    await form.getByLabel("Title pattern").fill("(unclosed");
    await form.getByLabel("Activity").selectOption({ label: "Development" });
    await form.getByRole("button", { name: "Add rule" }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    await expect(form.getByLabel("Title pattern")).toHaveAttribute("aria-invalid", "true");

    await form.getByLabel("Title pattern").fill("Tauri");
    await form.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByText("/Tauri/")).toBeVisible();
  });

  test("previews how much recent time a title rule would cover, then saves it as plain text", async ({ page }) => {
    await openSection(page, "Activities");

    const form = page.getByRole("form", { name: "Add rule" });
    const preview = form.getByTestId("rule-preview");
    await expect(preview).toContainText("Pick an app or type some text");

    await form.getByRole("radio", { name: "Window title" }).click();
    await form.getByLabel("Title contains").fill("DOCUMENTATION");
    // Matches "Tauri documentation" and today's Apple documentation tab, whatever the case.
    await expect(preview).toHaveText(/^This rule would cover \S+( \S+)? from the last 7 days across [2-9] windows\./);
    await expect(preview).toContainText("Unassigned now");

    await form.getByLabel("Title contains").fill("no window is called like this");
    await expect(preview).toHaveText("This rule would not cover any time from the last 7 days. It still applies to new time.");

    await form.getByLabel("Title contains").fill("documentation");
    await form.getByLabel("Activity").selectOption({ label: "Planning" });
    await form.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByRole("list", { name: "Window titles rules" })).toContainText("Title contains \u201cdocumentation\u201d");
  });

  test("explains Unassigned and the title matching modes in help tips", async ({ page }) => {
    await openSection(page, "Activities");

    const unassigned = page.getByRole("list", { name: "Activity list" }).getByRole("listitem").first();
    await expect(unassigned).toContainText("Time no rule matches yet");
    await unassigned.getByRole("button", { name: "About Unassigned" }).click();
    await expect(page.getByRole("dialog", { name: "Unassigned" })).toContainText("nothing is lost");
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Unassigned" })).toHaveCount(0);

    await unassigned.getByRole("button", { name: "See suggestions" }).click();
    await expect(page.getByRole("region", { name: "Suggestions" })).toBeFocused();

    const form = page.getByRole("form", { name: "Add rule" });
    await form.getByRole("radio", { name: "Window title" }).click();
    await form.getByRole("button", { name: "About matching window titles" }).click();
    await expect(page.getByRole("dialog", { name: "matching window titles" })).toContainText("Contains text");
  });

  test("has no accessibility violations", async ({ page }) => {
    await openSection(page, "Activities");
    await expect(page.getByRole("list", { name: "Activity list" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("guides a first setup: start empty, name an activity, add a rule, say how it counts", async ({ page }) => {
    await openFreshActivities(page);

    const guide = page.getByRole("region", { name: "Set up activities in three steps" });
    await expect(guide.getByRole("heading", { name: "Step 1 of 3: Create or pick activities" })).toBeVisible();
    const options = guide.getByRole("list", { name: "Ways to start" });
    await expect(options.getByRole("button", { name: "Preview the Design pack" })).toBeVisible();
    await expect(options.getByRole("radio")).toHaveCount(0);

    await options.getByRole("button", { name: "Start empty" }).click();
    // Nothing was created by choosing: only the system activity exists.
    await expect(page.getByRole("list", { name: "Activity list" }).getByRole("listitem")).toHaveCount(1);
    await guide.getByLabel("Name").fill("Deep work");
    await guide.getByRole("button", { name: "Add activity" }).click();

    await expect(guide.getByRole("heading", { name: "Step 2 of 3: Add rules" })).toBeFocused();
    await expect(guide).toContainText("By window title:");
    await guide.getByRole("button", { name: "Add a rule" }).click();
    await expect(page.getByRole("form", { name: "Add rule" }).getByRole("radio", { name: "App" })).toBeFocused();

    await guide.getByRole("button", { name: "Next: Mark how each activity counts" }).click();
    await expect(guide).toContainText("focus percentage in Overview and Review");
    await guide.getByRole("radiogroup", { name: "How Deep work counts" }).getByRole("radio", { name: "Productive" }).click();
    await expect(
      page.getByRole("list", { name: "Activity list" }).getByRole("listitem").filter({ hasText: "Deep work" }),
    ).toContainText("Productive");
    await expectNoA11yViolations(page);

    await guide.getByRole("button", { name: "Finish" }).click();
    await expect(guide).toHaveCount(0);

    // Closed for good, but "How this works" brings it back at the first step.
    await page.getByRole("navigation").getByRole("button", { name: /^Today/ }).click();
    await page.getByRole("navigation").getByRole("button", { name: /^Activities/ }).click();
    await expect(guide).toHaveCount(0);
    await page.getByRole("button", { name: "How this works" }).click();
    await expect(guide.getByRole("heading", { level: 2 })).toBeFocused();
    await expect(guide.getByRole("heading", { name: "Step 1 of 3: Create or pick activities" })).toBeVisible();
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
    // The guide moves on to rules.
    await expect(page.getByRole("heading", { name: "Step 2 of 3: Add rules" })).toBeFocused();
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

  test("the guided setup has no accessibility violations, in light and dark", async ({ page }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await openFreshActivities(page);
      await expect(page.getByRole("list", { name: "Ways to start" })).toBeVisible();
      await expectNoA11yViolations(page);
      await page.getByRole("button", { name: "Next: Add rules" }).click();
      await expectNoA11yViolations(page);
    }
  });
});
