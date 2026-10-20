import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { mergePatch, mockBackend, renderWithProviders, settings, status } from "@/test/ipc";

import { SettingsContainer } from "./SettingsContainer";

function lastUpdate(calls: { cmd: string; args: Record<string, unknown> }[]) {
  return calls.filter((c) => c.cmd === "settings_update").at(-1)?.args.patch as Record<string, unknown>;
}

describe("SettingsContainer", () => {
  it("shows the stored values with labelled controls", async () => {
    mockBackend({
      get_status: () => status(),
      settings_get: () => settings({ theme: "dark", idle_threshold_secs: 600, autostart: true, store_titles: false }),
    });
    renderWithProviders(<SettingsContainer />);

    expect(await screen.findByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Idle after" })).toHaveValue("600");
    expect(screen.getByRole("switch", { name: "Open at login" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Record window titles" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Global shortcut ⌃⌥⌘T, change" })).toBeInTheDocument();
  });

  it("saves the theme immediately and applies it (light/dark/system)", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      get_status: () => status(),
      settings_get: () => settings({ theme: "light" }),
      settings_update: (args) => mergePatch(args.patch),
    });
    renderWithProviders(<SettingsContainer />);

    await user.click(await screen.findByRole("radio", { name: "Dark" }));

    await waitFor(() => expect(lastUpdate(calls)).toMatchObject({ theme: "dark", autostart: null }));
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
  });

  it("saves the idle threshold in seconds (R3.1)", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      get_status: () => status(),
      settings_update: () => settings({ idle_threshold_secs: 600 }),
    });
    renderWithProviders(<SettingsContainer />);

    await user.selectOptions(await screen.findByRole("combobox", { name: "Idle after" }), "10 min");

    await waitFor(() => expect(lastUpdate(calls)).toMatchObject({ idle_threshold_secs: 600 }));
  });

  it("toggles autostart and title storage", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      get_status: () => status(),
      settings_update: (args) => mergePatch(args.patch),
    });
    renderWithProviders(<SettingsContainer />);

    await user.click(await screen.findByRole("switch", { name: "Open at login" }));
    await waitFor(() => expect(lastUpdate(calls)).toMatchObject({ autostart: true }));
    await user.click(screen.getByRole("switch", { name: "Record window titles" }));
    await waitFor(() => expect(lastUpdate(calls)).toMatchObject({ store_titles: false }));
  });

  it("records a new shortcut from the keyboard", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      get_status: () => status(),
      settings_update: () => settings({ shortcut: "⌃⌥⌘P" }),
    });
    renderWithProviders(<SettingsContainer />);

    await user.click(await screen.findByRole("button", { name: /Global shortcut/ }));
    expect(screen.getByRole("button", { name: "Press the new shortcut" })).toBeInTheDocument();
    await user.keyboard("{Control>}{Alt>}{Meta>}p{/Meta}{/Alt}{/Control}");

    await waitFor(() => expect(lastUpdate(calls)).toMatchObject({ shortcut: "⌃⌥⌘P" }));
    expect(await screen.findByRole("button", { name: "Global shortcut ⌃⌥⌘P, change" })).toBeInTheDocument();
  });

  it("cancels recording with Escape and ignores keys without a modifier", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({ get_status: () => status() });
    renderWithProviders(<SettingsContainer />);

    await user.click(await screen.findByRole("button", { name: /Global shortcut/ }));
    await user.keyboard("p");
    expect(screen.getByRole("button", { name: "Press the new shortcut" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: /Global shortcut/ })).toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "settings_update")).toBe(false);
  });

  it("shows a field-level error when the shortcut is taken (R6.3)", async () => {
    const user = userEvent.setup();
    mockBackend({
      get_status: () => status(),
      settings_update: () => {
        throw { kind: "shortcut_unavailable", shortcut: "⌃⌥⌘P", reason: "already in use" };
      },
    });
    renderWithProviders(<SettingsContainer />);

    await user.click(await screen.findByRole("button", { name: /Global shortcut/ }));
    await user.keyboard("{Control>}{Alt>}{Meta>}p{/Meta}{/Alt}{/Control}");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("⌃⌥⌘P is unavailable: already in use");
    const field = screen.getByRole("button", { name: /Global shortcut/ });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.getAttribute("aria-describedby")).toContain("setting-shortcut-error");
  });

  it("keeps showing the error from the persisted shortcut status", async () => {
    mockBackend({
      get_status: () =>
        status({ shortcut: { kind: "unavailable", shortcut: "⌃⌥⌘T", reason: "taken by another app" } }),
    });
    renderWithProviders(<SettingsContainer />);

    expect(await screen.findByRole("alert")).toHaveTextContent("taken by another app");
  });

  it("shows the degraded banner with a way to open System Settings (R5.3)", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      get_status: () => status({ degraded: true }),
      permission_open_settings: () => null,
    });
    renderWithProviders(<SettingsContainer />);

    const banner = await screen.findByText("Window titles are off");
    expect(banner).toBeInTheDocument();
    await user.click(within(screen.getByRole("status")).getByRole("button", { name: "Open System Settings" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "permission_open_settings")).toBe(true));
  });

  it("reports other save failures once at the top", async () => {
    const user = userEvent.setup();
    mockBackend({
      get_status: () => status(),
      settings_update: () => {
        throw { kind: "storage", message: "disk full" };
      },
    });
    renderWithProviders(<SettingsContainer />);

    await user.click(await screen.findByRole("switch", { name: "Open at login" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });
});
