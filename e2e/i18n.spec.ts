import { expect, expectNoA11yViolations, openSection, openWindow, test } from "./fixtures";

test.describe("Spanish interface", () => {
  test("choosing Español in Settings shows Today in Spanish", async ({ page }) => {
    await openSection(page, "Settings");
    await page.getByRole("combobox", { name: "Language" }).selectOption({ label: "Español" });

    await page.getByRole("navigation", { name: "Secciones" }).getByRole("button", { name: /^Hoy/ }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Hoy" })).toBeVisible();
    await expect(page.getByText("miércoles, 18 de marzo")).toBeVisible();
    await expect(page.getByRole("region", { name: "Tiempo activo y ausente" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Por app" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Tiempo por actividad" })).toBeVisible();
    // The header and the sidebar status line both read the tracking state.
    await expect(page.getByText("Registrando", { exact: true })).toHaveCount(2);
    await expectNoA11yViolations(page);
  });

  test("the menu bar popover follows the language setting", async ({ page }) => {
    await openWindow(page, "popover", "?language=es");

    await expect(page.getByRole("status", { name: "Estado: Registrando" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Hoy", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Pausar registro/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Abrir panel/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Iniciar un temporizador" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expectNoA11yViolations(page);
  });
});
