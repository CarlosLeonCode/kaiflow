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
    await expect(page.getByRole("heading", { name: "Iniciar enfoque" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Ausente 12m/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Conservar" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expectNoA11yViolations(page);
  });
});

test.describe("Spanish sections", () => {
  async function openSpanish(page: Parameters<typeof openWindow>[0], section: string): Promise<void> {
    await openWindow(page, "main", "?language=es");
    await page.getByRole("navigation", { name: "Secciones" }).getByRole("button", { name: new RegExp(`^${section}`) }).click();
    await expect(page.getByRole("heading", { level: 1, name: section })).toBeVisible();
  }

  test("Insights", async ({ page }) => {
    await openSpanish(page, "Estadísticas");

    await expect(page.getByRole("radio", { name: "Semana" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Semana siguiente" })).toBeDisabled();
    await expect(page.getByRole("region", { name: "Resumen" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Tiempo productivo" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Horas de más actividad" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Tiempo por actividad" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Tu nota" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Análisis con IA (opcional)" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("Activities", async ({ page }) => {
    await openSpanish(page, "Actividades");

    await expect(page.getByRole("list", { name: "Lista de actividades" })).toContainText("Sin asignar");
    await expect(page.getByRole("region", { name: "Reglas de clasificación" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Añadir regla" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nueva actividad" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cómo funciona" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("Privacy", async ({ page }) => {
    await openSpanish(page, "Privacidad");

    await expect(page.getByRole("region", { name: "Títulos de ventana" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Apps excluidas" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Limpieza automática" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Eliminar datos" })).toBeVisible();

    await page.getByRole("button", { name: "Eliminar todos los datos…" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("¿Eliminar todos los datos registrados?");
    await expect(dialog).toContainText("No se puede deshacer.");
    await expectNoA11yViolations(page);
  });

  test("Settings", async ({ page }) => {
    await openSpanish(page, "Ajustes");

    for (const panel of ["Apariencia", "Calendario", "Inactividad", "Sesiones de enfoque", "Registro", "Datos", "Análisis con IA", "Acerca de"]) {
      await expect(page.getByRole("region", { name: panel, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("combobox", { name: "Idioma" })).toHaveValue("es");
    await expect(page.getByRole("switch", { name: "Abrir al iniciar sesión" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Copia de seguridad diaria" })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
