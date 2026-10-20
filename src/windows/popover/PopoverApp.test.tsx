import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { mockBackend, renderWithProviders, report, status } from "@/test/ipc";

import { PopoverApp } from "./PopoverApp";

function backend() {
  return mockBackend({
    get_status: () => status(),
    get_report: () => report(),
    list_pending_idle_gaps: () => [],
    categories_list: () => [],
    hide_popover: () => null,
  });
}

describe("PopoverApp", () => {
  it("hides the popover on Escape through the backend (no window permission needed)", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<PopoverApp />);
    await screen.findByTestId("today-total");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(calls.filter((c) => c.cmd === "hide_popover")).toHaveLength(1));
  });

  it("ignores other keys and an Escape that something else already handled", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<PopoverApp />);
    await screen.findByTestId("today-total");

    await user.keyboard("a{Enter}");
    const handled = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener("keydown", handled, { capture: true });
    await user.keyboard("{Escape}");
    window.removeEventListener("keydown", handled, { capture: true });

    expect(calls.some((c) => c.cmd === "hide_popover")).toBe(false);
  });
});
