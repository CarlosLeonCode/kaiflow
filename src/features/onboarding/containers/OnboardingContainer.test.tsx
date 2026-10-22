import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { describe, expect, it } from "vitest";

import { mergePatch, mockBackend, platform, renderWithProviders, status } from "@/test/ipc";

import { OnboardingContainer } from "./OnboardingContainer";

async function toAccessStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Choose what to record" });
}

describe("OnboardingContainer", () => {
  it("explains what is read, why, and that everything is local (R5.1, R10.1)", async () => {
    mockBackend({ permission_status: () => "denied" });
    renderWithProviders(<OnboardingContainer />);

    expect(await screen.findByRole("heading", { name: "Know where your time goes" })).toHaveFocus();
    expect(screen.getByText("The app in front")).toBeInTheDocument();
    expect(screen.getByText("Window titles (optional)")).toBeInTheDocument();
    expect(screen.getByText(/Everything stays on this Mac/)).toBeInTheDocument();
    expect(screen.getByText(/Screen recording is never requested/)).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Welcome");
  });

  it("shows the title switch explicitly and saves it right away (S2)", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      permission_status: () => "denied",
      settings_update: (args) => mergePatch(args.patch),
    });
    renderWithProviders(<OnboardingContainer />);
    await toAccessStep(user);

    const toggle = screen.getByRole("switch", { name: "Record window titles" });
    expect(toggle).toBeChecked();
    await user.click(toggle);

    await waitFor(() => {
      const patch = calls.filter((c) => c.cmd === "settings_update").at(-1)?.args.patch;
      expect(patch).toMatchObject({ store_titles: false, onboarding_completed: null });
    });
    expect(screen.getByText("Not needed while window titles are off.")).toBeInTheDocument();
  });

  it("shows the live Accessibility status and opens System Settings (R5.2)", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      permission_status: () => "denied",
      permission_open_settings: () => null,
    });
    renderWithProviders(<OnboardingContainer />);
    await toAccessStep(user);

    const section = screen.getByRole("region", { name: "Accessibility access" });
    expect(await within(section).findByText("Missing")).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Open System Settings" }));

    await waitFor(() => expect(calls.some((c) => c.cmd === "permission_open_settings")).toBe(true));
  });

  it("turns green without reopening the window and offers a restart (R5.2, R5.4)", async () => {
    const user = userEvent.setup();
    let state: "denied" | "granted" = "denied";
    const { calls } = mockBackend({
      permission_status: () => state,
      app_restart: () => null,
    });
    renderWithProviders(<OnboardingContainer />);
    await toAccessStep(user);
    const section = screen.getByRole("region", { name: "Accessibility access" });
    await within(section).findByText("Missing");
    expect(screen.queryByText("Restart to apply")).toBeNull();

    state = "granted";
    await act(async () => {
      await emit("permission-changed", { state: "granted" });
    });

    expect(await within(section).findByText("Granted")).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Open System Settings" })).toBeNull();
    expect(screen.getByText("Restart to apply")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restart now" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "app_restart")).toBe(true));
  });

  it("does not offer a restart when access was already granted", async () => {
    const user = userEvent.setup();
    mockBackend({ permission_status: () => "granted" });
    renderWithProviders(<OnboardingContainer />);
    await toAccessStep(user);

    expect(await screen.findByText("Granted")).toBeInTheDocument();
    expect(screen.queryByText("Restart to apply")).toBeNull();
  });

  it("finishes: marks onboarding complete, starts tracking and closes the window", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      permission_status: () => "granted",
      settings_update: (args) => mergePatch(args.patch),
      start: () => status(),
      close_onboarding: () => null,
    });
    renderWithProviders(<OnboardingContainer />);
    await toAccessStep(user);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "You're all set" })).toBeInTheDocument();
    expect(screen.getByText("App names and window titles")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start tracking" }));

    await waitFor(() => expect(calls.some((c) => c.cmd === "close_onboarding")).toBe(true));
    const order = calls.map((c) => c.cmd).filter((c) => ["settings_update", "start", "close_onboarding"].includes(c));
    expect(order).toEqual(["settings_update", "start", "close_onboarding"]);
    const patch = calls.find((c) => c.cmd === "settings_update")?.args.patch;
    expect(patch).toMatchObject({ onboarding_completed: true, store_titles: null });
  });

  it("tracks at app level even without the grant (R5.3)", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      permission_status: () => "denied",
      settings_update: (args) => mergePatch(args.patch),
      start: () => status({ degraded: true }),
      close_onboarding: () => null,
    });
    renderWithProviders(<OnboardingContainer />);
    await toAccessStep(user);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/titles will be skipped/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start tracking" }));

    await waitFor(() => expect(calls.some((c) => c.cmd === "start")).toBe(true));
  });

  it("keeps the window open and shows the error when finishing fails", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      permission_status: () => "granted",
      settings_update: () => {
        throw { kind: "storage", message: "disk full" };
      },
    });
    renderWithProviders(<OnboardingContainer />);
    await toAccessStep(user);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Start tracking" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(calls.some((c) => c.cmd === "close_onboarding")).toBe(false);
    expect(screen.getByRole("button", { name: "Start tracking" })).toBeEnabled();
  });

  it("goes back a step", async () => {
    const user = userEvent.setup();
    mockBackend({ permission_status: () => "granted" });
    renderWithProviders(<OnboardingContainer />);
    await toAccessStep(user);

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByRole("heading", { name: "Know where your time goes" })).toBeInTheDocument();
  });

  describe("per platform", () => {
    it("macOS: names the Mac, asks for Accessibility and labels the step Permissions", async () => {
      const user = userEvent.setup();
      mockBackend({ platform_info: () => platform("macos"), permission_status: () => "denied" });
      renderWithProviders(<OnboardingContainer />);

      expect(await screen.findByText(/Everything stays on this Mac/)).toBeInTheDocument();
      expect(screen.getByText(/lives in your menu bar/)).toBeInTheDocument();
      expect(screen.getByRole("navigation", { name: "Progress" })).toHaveTextContent("Permissions");
      await toAccessStep(user);
      expect(screen.getByRole("region", { name: "Accessibility access" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open System Settings" })).toBeInTheDocument();
    });

    it("Windows: no permission step, what is read, and everything stays on the computer", async () => {
      const user = userEvent.setup();
      mockBackend({
        platform_info: () => platform("windows"),
        permission_status: () => "granted",
        settings_update: (args) => mergePatch(args.patch),
      });
      renderWithProviders(<OnboardingContainer />);

      expect(await screen.findByText(/Everything stays on this computer/)).toBeInTheDocument();
      expect(screen.getByText(/lives in your system tray/)).toBeInTheDocument();
      expect(screen.getByText(/Your screen, keystrokes and files are never read/)).toBeInTheDocument();
      expect(screen.queryByText(/this Mac/)).toBeNull();
      expect(screen.queryByText(/Accessibility/)).toBeNull();
      expect(screen.getByRole("navigation", { name: "Progress" })).toHaveTextContent("Recording");
      expect(screen.getByRole("navigation", { name: "Progress" })).not.toHaveTextContent("Permissions");

      await toAccessStep(user);
      expect(screen.getByRole("switch", { name: "Record window titles" })).toBeInTheDocument();
      const section = screen.getByRole("region", { name: "No permission needed" });
      expect(section).toHaveTextContent(/Windows lets Kaiflow read the active app and its window title/);
      expect(screen.queryByRole("region", { name: "Accessibility access" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Open System Settings" })).toBeNull();
      expect(screen.queryByText("Restart to apply")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Continue" }));
      expect(await screen.findByRole("heading", { name: "You're all set" })).toBeInTheDocument();
      expect(screen.getByText("None needed")).toBeInTheDocument();
      expect(screen.getByText(/Find Kaiflow in the system tray: click it/)).toBeInTheDocument();
      expect(screen.getByText(/turn on Open at login in Settings/)).toBeInTheDocument();
      expect(screen.queryByText(/AppIndicator/)).toBeNull();
    });

    it("Linux on X11: no permission step and the AppIndicator note", async () => {
      const user = userEvent.setup();
      mockBackend({ platform_info: () => platform("linux", "x11"), permission_status: () => "granted" });
      renderWithProviders(<OnboardingContainer />);

      expect(await screen.findByText(/Everything stays on this computer/)).toBeInTheDocument();
      await toAccessStep(user);
      expect(screen.getByRole("region", { name: "No permission needed" })).toHaveTextContent(/X11 session/);
      expect(screen.queryByRole("region", { name: "Wayland session" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Open System Settings" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Continue" }));
      expect(await screen.findByText("App names and window titles")).toBeInTheDocument();
      expect(screen.getByText(/needs the AppIndicator extension/)).toBeInTheDocument();
      expect(screen.getByText(/its menu pauses tracking/)).toBeInTheDocument();
    });

    it("Linux on Wayland: explains honestly that window tracking is unavailable", async () => {
      const user = userEvent.setup();
      const { calls } = mockBackend({
        platform_info: () => platform("linux", "wayland"),
        permission_status: () => "denied",
        settings_update: (args) => mergePatch(args.patch),
        start: () => status({ degraded: true, degraded_reason: "wayland_session" }),
        close_onboarding: () => null,
      });
      renderWithProviders(<OnboardingContainer />);

      expect(await screen.findByText(/Not available in a Wayland session/)).toBeInTheDocument();
      await toAccessStep(user);
      const section = screen.getByRole("region", { name: "Wayland session" });
      expect(within(section).getByRole("heading", { name: "Window tracking is unavailable on Wayland" })).toBeInTheDocument();
      expect(section).toHaveTextContent(/Idle, lock and sleep detection, focus timers and goals still work/);
      expect(section).toHaveTextContent(/Ubuntu on Xorg/);
      expect(screen.queryByRole("button", { name: "Open System Settings" })).toBeNull();
      expect(screen.queryByText("Restart to apply")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Continue" }));
      expect(await screen.findByText("Unavailable on Wayland")).toBeInTheDocument();
      expect(screen.getByText(/needs the AppIndicator extension/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Start tracking" }));
      await waitFor(() => expect(calls.some((c) => c.cmd === "close_onboarding")).toBe(true));
    });

    it("never offers a restart where no permission exists", async () => {
      const user = userEvent.setup();
      let state: "denied" | "granted" = "denied";
      mockBackend({ platform_info: () => platform("windows"), permission_status: () => state });
      renderWithProviders(<OnboardingContainer />);
      await toAccessStep(user);
      state = "granted";
      await act(async () => {
        await emit("permission-changed", { state: "granted" });
      });
      expect(screen.queryByText("Restart to apply")).toBeNull();
    });
  });
});
