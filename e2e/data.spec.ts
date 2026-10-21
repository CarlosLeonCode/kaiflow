import { expect, expectNoA11yViolations, openSection, openWindow, test } from "./fixtures";

const DATA = "Data";

test.describe("Settings > Data", () => {
  test("shows the backup state with its folder and the last backup", async ({ page }) => {
    await openSection(page, "Settings");

    const data = page.getByRole("region", { name: DATA });
    await expect(data.getByRole("switch", { name: "Daily backup" })).toBeChecked();
    await expect(data.getByTestId("backup-folder")).toContainText("/backups");
    await expect(data.getByTestId("last-backup")).toContainText("Today at");
    await expect(data.getByRole("button", { name: "Restore from file…" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("backs up now and switches the folder", async ({ page }) => {
    await openSection(page, "Settings");
    const data = page.getByRole("region", { name: DATA });

    await data.getByRole("button", { name: "Back up now" }).click();
    await expect(data.getByText(/Backup saved to .*kaiflow-backup-today\.json\.gz/)).toBeVisible();

    await data.getByRole("button", { name: "Choose folder…" }).click();
    await expect(data.getByTestId("backup-folder")).toContainText("/Volumes/Backups/Kaiflow");
    await data.getByRole("button", { name: "Use default" }).click();
    await expect(data.getByTestId("backup-folder")).toContainText("/backups");
  });

  test("a failing backup shows what went wrong and how to fix it", async ({ page }) => {
    await openWindow(page, "main", "?backup=failing");
    await page.getByRole("navigation").getByRole("button", { name: /^Settings/ }).click();
    const data = page.getByRole("region", { name: DATA });

    await expect(data.getByText(/The last backup failed: could not write the backup/)).toBeVisible();
    await data.getByRole("button", { name: "Back up now" }).click();
    await expect(data.getByText(/The backup failed: .*permission denied/)).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("restoring previews the file, needs a confirmation and reloads the views", async ({ page }) => {
    // An activity created after "the backup" must disappear once it is restored.
    await openSection(page, "Activities");
    await page.getByRole("button", { name: "New activity" }).click();
    await page.getByLabel("Name").fill("Created after the backup");
    await page.getByRole("button", { name: "Add activity" }).click();
    await expect(page.getByRole("list", { name: "Activity list" })).toContainText("Created after the backup");

    await page.getByRole("navigation").getByRole("button", { name: /^Settings/ }).click();
    await page.getByRole("button", { name: "Restore from file…" }).click();

    const dialog = page.getByRole("alertdialog", { name: "Restore this file?" });
    await expect(dialog).toContainText("kaiflow-backup-yesterday.json.gz holds");
    await expect(dialog).toContainText("replaces everything stored now");
    await expectNoA11yViolations(page);
    // Focus starts on Cancel; nothing is restored until the explicit confirmation.
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Restore and replace" }).click();

    await expect(page.getByText(/Restored\. A safety copy of the previous data/)).toBeVisible();
    await expect(dialog).toHaveCount(0);

    await page.getByRole("navigation").getByRole("button", { name: /^Activities/ }).click();
    await expect(page.getByRole("list", { name: "Activity list" })).not.toContainText("Created after the backup");
  });

  test("cancelling the preview leaves the data alone", async ({ page }) => {
    await openSection(page, "Settings");
    await page.getByRole("button", { name: "Restore from file…" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByText(/Restored\./)).toHaveCount(0);
  });

  test("the purge confirmation says how much goes", async ({ page }) => {
    await openSection(page, "Privacy");
    await page.getByRole("button", { name: "Delete older data…" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(/This would delete \d+ segments?\.|Nothing is older than that/);
  });
});
