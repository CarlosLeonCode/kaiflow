import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { mergePatch, mockBackend, platform, renderWithProviders, settings, status } from "@/test/ipc";

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
    expect(screen.getByRole("combobox", { name: "Show next to the icon" })).toHaveValue("today_total");
  });

  it("uses Windows conventions: key names, the PC default and no Mac wording", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      platform_info: () => platform("windows"),
      get_status: () => status({ shortcut: { kind: "registered", shortcut: "⌃⌥⌘T" } }),
      settings_get: () => settings({ shortcut: "⌃⌥⌘T" }),
      settings_update: (args) => mergePatch(args.patch),
    });
    renderWithProviders(<SettingsContainer />);

    const field = await screen.findByRole("button", { name: "Global shortcut Ctrl+Alt+Win+T, change" });
    expect(within(field).getByText("Win")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "System tray" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Show in the icon tooltip" })).toBeInTheDocument();
    expect(screen.getByText("Start tracking when you log in to this computer.")).toBeInTheDocument();
    expect(screen.queryByText(/this Mac|Accessibility/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Reset shortcut to default" }));
    await waitFor(() => expect(lastUpdate(calls)).toMatchObject({ shortcut: "⌃⌥⇧K" }));
  });

  it("explains on Wayland that titles cannot be read", async () => {
    mockBackend({
      platform_info: () => platform("linux", "wayland"),
      get_status: () => status({ degraded: true, degraded_reason: "wayland_session" }),
      settings_get: () => settings({ shortcut: "⌃⌥⇧K" }),
    });
    renderWithProviders(<SettingsContainer />);

    expect(await screen.findByText(/Titles cannot be read in a Wayland session/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Global shortcut Ctrl+Alt+Shift+K, change" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset shortcut to default" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open System Settings" })).toBeNull();
  });

  it("shows the version, the MIT license and the repository in About", async () => {
    mockBackend({ get_status: () => status() });
    renderWithProviders(<SettingsContainer />);

    const about = await screen.findByRole("region", { name: "About" });
    expect(within(about).getByText("0.0.0-test")).toBeInTheDocument();
    expect(within(about).getByText("MIT")).toBeInTheDocument();
    expect(within(about).getByText("https://github.com/CarlosLeonCode/kaiflow")).toBeInTheDocument();
    expect(about).not.toHaveTextContent(/notari/i);
  });

  it("saves what the menu bar shows next to the icon", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      get_status: () => status(),
      settings_update: (args) => mergePatch(args.patch),
    });
    renderWithProviders(<SettingsContainer />);

    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Show next to the icon" }),
      "Current app (Xcode · 40m)",
    );

    await waitFor(() => expect(lastUpdate(calls)).toMatchObject({ tray_display: "current_app", theme: null }));
  });

  it("saves the first day of the week", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      get_status: () => status(),
      settings_update: (args) => mergePatch(args.patch),
    });
    renderWithProviders(<SettingsContainer />);

    const select = await screen.findByRole("combobox", { name: "Week starts on" });
    expect(select).toHaveValue("0");
    await user.selectOptions(select, "Sunday");

    await waitFor(() => expect(lastUpdate(calls)).toMatchObject({ week_start: 6, theme: null }));
  });

  it("offers the top goal in the menu bar", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      get_status: () => status(),
      settings_update: (args) => mergePatch(args.patch),
    });
    renderWithProviders(<SettingsContainer />);

    await user.selectOptions(await screen.findByRole("combobox", { name: "Show next to the icon" }), "Top goal (2h 10m / 3h)");

    await waitFor(() => expect(lastUpdate(calls)).toMatchObject({ tray_display: "goal_progress" }));
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

  it("saves the auto-discard limit and the prompt timeout", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      get_status: () => status(),
      settings_update: (args) => mergePatch(args.patch),
    });
    renderWithProviders(<SettingsContainer />);

    const limit = await screen.findByRole("combobox", { name: "Skip the prompt for short breaks" });
    expect(limit).toHaveValue("120");
    await user.selectOptions(limit, "Always ask");
    await waitFor(() => expect(lastUpdate(calls)).toMatchObject({ idle_auto_discard_below_secs: 0 }));

    await user.selectOptions(screen.getByRole("combobox", { name: "Answer the prompt within" }), "5 min");
    await waitFor(() => expect(lastUpdate(calls)).toMatchObject({ idle_prompt_timeout_secs: 300 }));
  });

  it("saves how long the user may drift away from a focus session", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      get_status: () => status(),
      settings_update: (args) => mergePatch(args.patch),
    });
    renderWithProviders(<SettingsContainer />);

    const delay = await screen.findByRole("combobox", { name: "Nudge me after" });
    expect(delay).toHaveValue("90");
    await user.selectOptions(delay, "3 min");
    await waitFor(() => expect(lastUpdate(calls)).toMatchObject({ focus_drift_after_secs: 180 }));
  });

  it("saves the pomodoro cycle, sound and heads-up as one blob", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      get_status: () => status(),
      settings_update: (args) => mergePatch(args.patch),
    });
    renderWithProviders(<SettingsContainer />);

    await user.selectOptions(await screen.findByRole("combobox", { name: "Short break" }), "10 min");
    await waitFor(() =>
      expect(lastUpdate(calls)).toMatchObject({ focus_timer: { short_break_minutes: 10, long_break_minutes: 15, sound: true } }),
    );
    await user.click(screen.getByRole("switch", { name: "One-minute heads-up" }));
    await waitFor(() => expect(lastUpdate(calls)).toMatchObject({ focus_timer: { heads_up: true, short_break_minutes: 10 } }));
    await user.click(screen.getByRole("switch", { name: "Pomodoro cycle" }));
    await waitFor(() => expect(lastUpdate(calls)).toMatchObject({ focus_timer: { cycle_enabled: false } }));
    // Without the cycle there are no breaks to configure.
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Short break" })).not.toBeInTheDocument());
    expect(screen.getByRole("switch", { name: "Sound" })).toBeChecked();
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
