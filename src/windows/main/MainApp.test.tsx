import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { mockBackend, renderWithProviders, report, settings, status } from "@/test/ipc";

import { MainApp } from "./MainApp";

function backend() {
  return mockBackend({
    get_status: () => status(),
    get_report: () => report(),
    get_timeline: () => [],
    settings_get: () => settings(),
    categories_list: () => [{ id: 1, name: "Sin categoría", color: "#6b7280", sort_order: 0 }],
    rules_list: () => [],
    privacy_list: () => ({ store_titles: true, excluded_apps: [], redacted_apps: [] }),
  });
}

describe("MainApp shell", () => {
  it("opens on Today with the five sections in the sidebar", async () => {
    backend();
    renderWithProviders(<MainApp />);

    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent?.replace(/⌘\d/, ""))).toEqual([
      "Today",
      "History",
      "Categories",
      "Privacy",
      "Settings",
    ]);
    expect(within(nav).getByRole("button", { name: /Today/ })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
  });

  it("switches sections by click", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<MainApp />);

    await user.click(screen.getByRole("button", { name: /Settings/ }));

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Settings/ })).toHaveAttribute("aria-current", "page");
  });

  it("switches sections with ⌘1..⌘5 and reserves ⌘K", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<MainApp />);

    await user.keyboard("{Meta>}3{/Meta}");
    expect(await screen.findByRole("heading", { level: 1, name: "Categories" })).toBeInTheDocument();
    await user.keyboard("{Meta>}5{/Meta}");
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    await user.keyboard("{Meta>}1{/Meta}");
    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
  });

  it("renders History, Categories and Privacy", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<MainApp />);

    for (const name of ["History", "Categories", "Privacy"]) {
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
    expect(screen.getByRole("button", { name: /Settings/ })).toHaveAttribute("aria-current", "page");
  });

  it("shows the tracking status at the bottom of the sidebar", async () => {
    backend();
    renderWithProviders(<MainApp />);

    await waitFor(() => expect(screen.getByText("Tracking")).toBeInTheDocument());
  });
});
