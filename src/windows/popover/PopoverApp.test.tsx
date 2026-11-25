import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { SettingsDto } from "@/shared/ipc";
import { mockBackend, renderWithProviders, report, settings, status } from "@/test/ipc";

import { PopoverApp } from "./PopoverApp";

function backend(overrides: Partial<SettingsDto> = {}) {
  return mockBackend({
    settings_get: () => settings(overrides),
    get_status: () => status(),
    get_report: () => report(),
    list_pending_idle_gaps: () => [],
    activities_list: () => [],
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

  it("shows the popover in Spanish when the language setting is Español", async () => {
    backend({ language: "es" });
    renderWithProviders(<PopoverApp />);

    expect(await screen.findByRole("status", { name: "Estado: Registrando" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Hoy" })).toBeInTheDocument();
    expect(screen.getByText("Ahora")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pausar registro/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Abrir panel/ })).toBeInTheDocument();
    expect(await screen.findByText("Aún no hay actividad registrada hoy.")).toBeInTheDocument();
  });
});
