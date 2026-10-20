import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";

/** Wednesday 18 March 2026, 14:00 in Europe/Madrid (the zone set in playwright.config.ts). */
export const NOW = new Date("2026-03-18T14:00:00+01:00");

/** Every test starts at the same instant, so "today" and the seeded history are stable. */
export const test = base.extend({
  page: async ({ page }, provide) => {
    await page.clock.setFixedTime(NOW);
    await provide(page);
  },
});

export { expect };

/** The three windows the app opens; the popover and onboarding have fixed sizes. */
export const WINDOWS = {
  popover: { path: "/popover.html", viewport: { width: 360, height: 480 } },
  main: { path: "/main.html", viewport: { width: 1040, height: 720 } },
  onboarding: { path: "/onboarding.html", viewport: { width: 560, height: 640 } },
} as const;

export async function openWindow(page: Page, name: keyof typeof WINDOWS, query = ""): Promise<void> {
  await page.setViewportSize(WINDOWS[name].viewport);
  await page.goto(`${WINDOWS[name].path}${query}`);
}

/** Opens a dashboard section through the sidebar. */
export async function openSection(page: Page, section: string): Promise<void> {
  await openWindow(page, "main");
  await page.getByRole("navigation").getByRole("button", { name: new RegExp(`^${section}`) }).click();
}

/** Fails on any WCAG 2 A/AA violation of the current page and prints what broke. */
export async function expectNoA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(" | ")})`);
  expect(summary, "accessibility violations").toEqual([]);
}
