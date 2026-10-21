import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { aiSettings, dashboard, mockBackend, renderWithProviders, report, review, settings, status } from "@/test/ipc";

import { MainApp } from "./MainApp";

function backend() {
  return mockBackend({
    get_status: () => status(),
    get_report: () => report(),
    get_dashboard: () => dashboard(),
    get_timeline: () => [],
    goals_status: () => [],
    goals_list: () => [],
    settings_get: () => settings(),
    activities_list: () => [{ id: 1, name: "Unassigned", color: "#6b7280", sort_order: 0 }],
    rules_list: () => [],
    review_get: () => review(),
    ai_settings_get: () => aiSettings(),
    ai_reviews_list: () => [],
    privacy_list: () => ({ store_titles: true, excluded_apps: [], redacted_apps: [] }),
  });
}

describe("MainApp shell", () => {
  it("opens on Today with the eight sections in the sidebar", async () => {
    backend();
    renderWithProviders(<MainApp />);

    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent?.replace(/⌘\d/, ""))).toEqual([
      "Today",
      "Overview",
      "Goals",
      "Focus",
      "Review",
      "Activities",
      "Privacy",
      "Settings",
    ]);
    expect(within(nav).getByRole("button", { name: /Today/ })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
  });

  it("opens Overview with ⌘2", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<MainApp />);

    await user.keyboard("{Meta>}2{/Meta}");
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
  });

  it("switches sections by click", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<MainApp />);

    await user.click(screen.getByRole("button", { name: /Settings/ }));

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation")).getByRole("button", { name: /Settings/ })).toHaveAttribute("aria-current", "page");
  });

  it("switches sections with ⌘1..⌘8 and reserves ⌘K", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<MainApp />);

    await user.keyboard("{Meta>}3{/Meta}");
    expect(await screen.findByRole("heading", { level: 1, name: "Goals" })).toBeInTheDocument();
    await user.keyboard("{Meta>}4{/Meta}");
    expect(await screen.findByRole("heading", { level: 1, name: "Focus" })).toBeInTheDocument();
    await user.keyboard("{Meta>}5{/Meta}");
    expect(await screen.findByRole("heading", { level: 1, name: "Review" })).toBeInTheDocument();
    await user.keyboard("{Meta>}6{/Meta}");
    expect(await screen.findByRole("heading", { level: 1, name: "Activities" })).toBeInTheDocument();
    await user.keyboard("{Meta>}8{/Meta}");
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    await user.keyboard("{Meta>}1{/Meta}");
    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
  });

  it("highlights exactly the rendered section, immediately and without a color transition", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<MainApp />);
    const nav = screen.getByRole("navigation", { name: "Sections" });
    const current = () => within(nav).getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page");

    const steps: [() => Promise<void>, string][] = [
      [() => user.click(within(nav).getByRole("button", { name: /Activities/ })), "Activities"],
      [() => user.click(within(nav).getByRole("button", { name: /Overview/ })), "Overview"],
      [() => user.keyboard("{Meta>}6{/Meta}"), "Activities"],
      [() => user.keyboard("{Meta>}1{/Meta}"), "Today"],
    ];
    for (const [act, name] of steps) {
      await act();
      // Same render as the section switch: no waiting for data or animation.
      expect(current().map((b) => b.textContent?.replace(/⌘\d/, ""))).toEqual([name]);
      expect(await screen.findByRole("heading", { level: 1, name })).toBeInTheDocument();
    }
    // Regression: an animated background made the previous item look selected while the
    // webview was not painting (the highlight is sampled from the animation timeline).
    for (const button of within(nav).getAllByRole("button")) {
      expect(button.className).not.toMatch(/\btransition/);
    }
  });

  it("renders Overview, Goals, Activities and Privacy", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<MainApp />);

    for (const name of ["Overview", "Goals", "Review", "Activities", "Privacy"]) {
      await user.click(screen.getByRole("button", { name: new RegExp(name) }));
      expect(await screen.findByRole("heading", { level: 1, name })).toBeInTheDocument();
    }
    expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
  });

  it("Privacy links to Settings for the global title switch", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<MainApp />);

    await user.click(screen.getByRole("button", { name: /Privacy/ }));
    await user.click(await screen.findByRole("button", { name: "Change in Settings" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation")).getByRole("button", { name: /Settings/ })).toHaveAttribute("aria-current", "page");
  });

  it("an empty day while tracking runs leads to Activities", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<MainApp />);

    await user.click(await screen.findByRole("button", { name: "Set up activities" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Activities" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation")).getByRole("button", { name: /Activities/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("every section has a help button in its header", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<MainApp />);
    const nav = screen.getByRole("navigation");
    for (const name of ["Today", "Overview", "Goals", "Focus", "Review", "Activities", "Privacy", "Settings"]) {
      await user.click(within(nav).getByRole("button", { name: new RegExp(`^${name}`) }));
      expect(await screen.findByRole("button", { name: `Help for ${name}` })).toBeInTheDocument();
    }
  });

  it("shows the tracking status at the bottom of the sidebar", async () => {
    backend();
    renderWithProviders(<MainApp />);

    await waitFor(() => expect(screen.getByText("Tracking")).toBeInTheDocument());
  });
});
