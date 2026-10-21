import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { focus, goalStatus, mockBackend, renderWithProviders, report, status } from "@/test/ipc";

import { TrackingPopoverContainer } from "./TrackingPopoverContainer";

const TWO_HOURS = 2 * 3_600_000;

describe("TrackingPopoverContainer", () => {
  it("shows today's total, the current app with its title and the top apps", async () => {
    mockBackend({
      get_status: () => status(),
      get_report: () =>
        report({
          total_ms: TWO_HOURS + 14 * 60_000,
          by_app: [
            { app_id: "com.apple.dt.Xcode", app_name: "Xcode", total_ms: TWO_HOURS },
            { app_id: "com.apple.Safari", app_name: "Safari", total_ms: 14 * 60_000 },
          ],
        }),
    });
    renderWithProviders(<TrackingPopoverContainer />);

    await waitFor(() => expect(screen.getByTestId("today-total")).toHaveTextContent("2:14:"));
    await screen.findByText("2h 00m");
    const current = screen.getByRole("region", { name: "Current activity" });
    expect(within(current).getByText("Xcode")).toBeInTheDocument();
    expect(within(current).getByText("AppDelegate.swift")).toBeInTheDocument();
    const top = screen.getByRole("region", { name: "Top apps today" });
    expect(within(top).getAllByRole("listitem")).toHaveLength(2);
    expect(within(top).getByText("2h 00m")).toBeInTheDocument();
  });

  it("shows only the two goals most worth a glance, unseen crossings first", async () => {
    mockBackend({
      get_status: () => status({ state: "paused", current: null, since: null }),
      get_report: () => report(),
      goals_status: () => [
        goalStatus({ state: "reached" }, { id: 1, label: "Done early" }),
        goalStatus({}, { id: 2, label: "In progress" }),
        goalStatus({ unseen: "exceeded", state: "exceeded" }, { id: 3, label: "Mail limit", kind: "maximum" }),
      ],
    });
    renderWithProviders(<TrackingPopoverContainer />);

    const goals = await screen.findByRole("region", { name: "Goals" });
    const items = within(goals).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Mail limit")).toBeInTheDocument();
    expect(within(items[0]!).getByText("Limit passed")).toBeInTheDocument();
    expect(within(items[1]!).getByText("In progress")).toBeInTheDocument();
  });

  it("shows no goals block when there are none", async () => {
    mockBackend({ get_status: () => status(), get_report: () => report(), goals_status: () => [] });
    renderWithProviders(<TrackingPopoverContainer />);

    await screen.findByRole("region", { name: "Top apps today" });
    expect(screen.queryByRole("region", { name: "Goals" })).not.toBeInTheDocument();
  });

  it("renders window titles as literal text (R7.3)", async () => {
    const hostile = '<img src=x onerror="alert(1)">';
    mockBackend({
      get_status: () => status({ current: focus({ window_title: hostile }) }),
      get_report: () => report(),
    });
    const { container } = renderWithProviders(<TrackingPopoverContainer />);

    expect(await screen.findByText(hostile)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("pauses and resumes through the backend and reflects the new state", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      get_status: () => status(),
      get_report: () => report(),
      pause: () => status({ state: "paused", current: null, since: null }),
    });
    renderWithProviders(<TrackingPopoverContainer />);

    await user.click(await screen.findByRole("button", { name: "Pause" }));

    expect(await screen.findByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(calls.some((call) => call.cmd === "pause")).toBe(true);
    expect(screen.getByText("Paused. Resume to keep counting.")).toBeInTheDocument();
  });

  it("opens the main window from the footer", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      get_status: () => status(),
      get_report: () => report(),
      open_main_window: () => null,
    });
    renderWithProviders(<TrackingPopoverContainer />);

    await user.click(await screen.findByRole("button", { name: "Open dashboard" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "open_main_window")).toBe(true));
  });

  it("shows the degraded banner (R5.3) and opens System Settings from it", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({
      get_status: () => status({ degraded: true, current: focus({ window_title: null }) }),
      get_report: () => report(),
      permission_open_settings: () => null,
    });
    renderWithProviders(<TrackingPopoverContainer />);

    expect(await screen.findByText("Window titles are off")).toBeInTheDocument();
    expect(screen.getByText("No window title")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open System Settings" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "permission_open_settings")).toBe(true));
  });

  it("explains a Wayland session without offering System Settings", async () => {
    mockBackend({
      get_status: () =>
        status({ degraded: true, degraded_reason: "wayland_session", current: null, since: null }),
      get_report: () => report(),
    });
    renderWithProviders(<TrackingPopoverContainer />);

    expect(await screen.findByText("Window tracking is unavailable on Wayland")).toBeInTheDocument();
    expect(screen.getByText(/Idle detection still works/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open System Settings" })).not.toBeInTheDocument();
  });

  it("shows the shortcut-unavailable banner with the reason (R6.3)", async () => {
    mockBackend({
      get_status: () =>
        status({ shortcut: { kind: "unavailable", shortcut: "⌃⌥⌘T", reason: "already in use" } }),
      get_report: () => report(),
    });
    renderWithProviders(<TrackingPopoverContainer />);

    expect(await screen.findByText("Shortcut ⌃⌥⌘T is unavailable")).toBeInTheDocument();
    expect(screen.getByText(/already in use/)).toBeInTheDocument();
    // Tracking stays usable: the pause button is still there.
    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
  });

  it("disables pause while idle or asleep", async () => {
    mockBackend({
      get_status: () => status({ state: "idle", current: null, since: null }),
      get_report: () => report(),
    });
    renderWithProviders(<TrackingPopoverContainer />);

    expect(await screen.findByText("You seem to be away.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();
  });

  it("refetches the report when the backend announces data changes", async () => {
    let total = 60_000;
    mockBackend({
      get_status: () => status({ state: "paused", current: null, since: null }),
      get_report: () => report({ total_ms: total }),
    });
    renderWithProviders(<TrackingPopoverContainer />);
    await screen.findByText("0:01:00");

    total = 120_000;
    await act(async () => {
      await emit("data-changed", { kind: "segments" });
    });

    await waitFor(() => expect(screen.getByTestId("today-total")).toHaveTextContent("0:02:00"));
  });

  it("applies a pushed status without another request", async () => {
    mockBackend({ get_status: () => status(), get_report: () => report() });
    renderWithProviders(<TrackingPopoverContainer />);
    await screen.findByRole("button", { name: "Pause" });

    await act(async () => {
      await emit("tracking-status-changed", status({ state: "paused", current: null, since: null }));
    });

    expect(await screen.findByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  describe("live total", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("grows every second while running without new IPC calls (R7.4)", async () => {
      const { calls } = mockBackend({
        get_status: () => status(),
        get_report: () => report({ total_ms: 60_000 }),
      });
      renderWithProviders(<TrackingPopoverContainer />);
      const total = await screen.findByText("0:01:00");
      expect(total).toBeInTheDocument();
      const before = calls.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      expect(screen.getByTestId("today-total")).toHaveTextContent("0:01:05");
      expect(calls.length).toBe(before);
    });

    it("stays still while paused", async () => {
      mockBackend({
        get_status: () => status({ state: "paused", current: null, since: null }),
        get_report: () => report({ total_ms: 60_000 }),
      });
      renderWithProviders(<TrackingPopoverContainer />);
      await screen.findByText("0:01:00");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      expect(screen.getByTestId("today-total")).toHaveTextContent("0:01:00");
    });
  });
});
