import { expect, expectNoA11yViolations, openSection, openWindow, test } from "./fixtures";

const DEMO = "?goals=demo";

async function openGoals(page: Parameters<typeof openSection>[0], query = "") {
  await openWindow(page, "main", query);
  await page.getByRole("navigation").getByRole("button", { name: /^Goals/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Goals" })).toBeVisible();
}

test.describe("Goals", () => {
  test("starts with an invitation to create the first goal", async ({ page }) => {
    await openGoals(page);

    await expect(page.getByRole("heading", { name: "No goals yet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create a goal" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("creates a goal from a plain sentence, then edits and archives it", async ({ page }) => {
    await openGoals(page);

    await page.getByRole("button", { name: "Create a goal" }).click();
    const dialog = page.getByRole("dialog", { name: "New goal" });
    await dialog.getByRole("combobox", { name: "Activity" }).selectOption({ label: "Development" });
    await dialog.getByRole("spinbutton", { name: "Hours" }).fill("4");
    await dialog.getByRole("radio", { name: "Weekdays" }).click();
    await expect(dialog.getByTestId("goal-preview")).toHaveText("At least 4h of Development every weekday.");
    await expectNoA11yViolations(page);
    await dialog.getByRole("button", { name: "Add goal" }).click();

    const list = page.getByRole("list", { name: "Goal list" });
    await expect(list).toContainText("Development, at least 4h daily");
    await expect(list).toContainText("At least 4h of Development every weekday.");
    // Today is 2h45m of Development, so the goal is in progress.
    await expect(list.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "68");

    await page.getByRole("button", { name: "Edit Development, at least 4h daily" }).click();
    const edit = page.getByRole("dialog", { name: "Edit goal" });
    await edit.getByRole("spinbutton", { name: "Hours" }).fill("2");
    await edit.getByRole("button", { name: "Save goal" }).click();
    // 2h of 2h45m: reached.
    await expect(list).toContainText("At least 2h of Development every weekday.");
    await expect(list).toContainText("Goal reached");

    await page.getByRole("button", { name: "Archive Development, at least 4h daily" }).click();
    await expect(page.getByRole("list", { name: "Archived list" })).toContainText("Development, at least 4h daily");
    await expect(page.getByRole("list", { name: "Goal list" })).toHaveCount(0);
  });

  test("deleting asks first", async ({ page }) => {
    await openGoals(page, DEMO);

    await page.getByRole("button", { name: "Delete Show up" }).click();
    const dialog = page.getByRole("alertdialog", { name: 'Delete "Show up"?' });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Delete goal" }).click();

    await expect(page.getByRole("list", { name: "Goal list" })).not.toContainText("Show up");
  });

  test("an exceeded limit shows an alert badge until it is dismissed", async ({ page }) => {
    await openGoals(page, DEMO);

    const list = page.getByRole("list", { name: "Goal list" });
    const slack = list.getByRole("listitem").filter({ hasText: "Slack limit" });
    await expect(slack).toContainText("No more than 20m in Slack every day.");
    await expect(slack.getByTestId("goal-badge")).toHaveText("Limit passed");
    await expect(slack).toContainText("5m over");
    await expectNoA11yViolations(page);

    await slack.getByTestId("goal-badge").click();
    await expect(slack.getByTestId("goal-badge")).toHaveCount(0);
  });

  test("shows streaks for the demo goals", async ({ page }) => {
    await openGoals(page, DEMO);

    const showUp = page.getByRole("list", { name: "Goal list" }).getByRole("listitem").filter({ hasText: "Show up" });
    await expect(showUp).toContainText(/Streak: \d+ days in a row/);
  });

  test("a rejected goal explains why", async ({ page }) => {
    await openGoals(page);

    await page.getByRole("button", { name: "Create a goal" }).click();
    const dialog = page.getByRole("dialog", { name: "New goal" });
    await dialog.getByRole("spinbutton", { name: "Hours" }).fill("0");
    await dialog.getByRole("button", { name: "Add goal" }).click();

    await expect(dialog.getByRole("alert")).toHaveText("The target must be longer than zero.");
  });
});

test.describe("Goals on Today, the popover and Overview", () => {
  test("Today invites the user to create a goal and jumps to Goals", async ({ page }) => {
    await openSection(page, "Today");

    const strip = page.getByRole("region", { name: "Goals" });
    await expect(strip.getByText("No goals yet")).toBeVisible();
    await expectNoA11yViolations(page);
    await strip.getByRole("button", { name: "Create a goal" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Goals" })).toBeVisible();
  });

  test("Today shows progress, streaks and the crossed limit", async ({ page }) => {
    await openWindow(page, "main", DEMO);

    const strip = page.getByRole("region", { name: "Goals" });
    const rows = strip.getByRole("listitem");
    await expect(rows).toHaveCount(4);
    // The unseen crossing is listed first.
    await expect(rows.first()).toContainText("Slack limit");
    await expect(rows.first().getByTestId("goal-badge")).toHaveText("Limit passed");
    await expectNoA11yViolations(page);

    // "Show up" reached its target today, so it carries a badge too.
    await expect(strip.getByTestId("goal-badge")).toHaveCount(2);
    await rows.first().getByRole("button", { name: /Dismiss the alert/ }).click();
    await expect(strip.getByTestId("goal-badge")).toHaveCount(1);
    await expect(strip.getByTestId("goal-badge")).toHaveText("Goal reached");
  });

  test("the popover shows the two goals most worth a glance", async ({ page }) => {
    await openWindow(page, "popover", DEMO);

    const goals = page.getByRole("region", { name: "Goals" });
    await expect(goals.getByRole("listitem")).toHaveCount(2);
    await expect(goals.getByRole("listitem").first()).toContainText("Slack limit");
    await expect(goals.getByRole("listitem").first()).toContainText("Limit passed");
    await expectNoA11yViolations(page);
  });

  test("the popover has no goals block without goals", async ({ page }) => {
    await openWindow(page, "popover");

    await expect(page.getByTestId("today-total")).toBeVisible();
    await expect(page.getByRole("region", { name: "Goals" })).toHaveCount(0);
  });

  test("Overview lists the goals of the period", async ({ page }) => {
    await openWindow(page, "main", DEMO);
    await page.getByRole("navigation").getByRole("button", { name: /^Overview/ }).click();

    const card = page.getByRole("region", { name: "Goals" });
    await expect(card.getByRole("listitem")).toHaveCount(4);
    await expect(card).toContainText("Weekly development");
    await expectNoA11yViolations(page);
  });

  test("a purge warns when it would cut an active streak", async ({ page }) => {
    await openWindow(page, "main", DEMO);
    await page.getByRole("navigation").getByRole("button", { name: /^Privacy/ }).click();
    await page.getByLabel("Older than (days)").fill("20");
    await page.getByRole("button", { name: "Delete older data…" }).click();

    await expect(page.getByRole("alertdialog")).toContainText(/reaches into an active goal streak and would cut \d+ days? of it/);
  });
});

test.describe("Week start", () => {
  test("changing the first day of the week reorders the heatmap and moves the week", async ({ page }) => {
    await openSection(page, "Settings");
    await page.getByRole("combobox", { name: "Week starts on" }).selectOption("Sunday");

    await page.getByRole("navigation").getByRole("button", { name: /^Overview/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: /Mar 15/ })).toBeVisible();
    const grid = page.getByRole("grid", { name: "Tracked time by weekday and hour" });
    await expect(grid.getByRole("row").first().getByRole("gridcell").first()).toHaveAttribute("aria-label", /^Sunday/);
  });
});
