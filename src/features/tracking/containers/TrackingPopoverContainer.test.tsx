import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { focus, focusActive, focusSession, goalStatus, idleFocus, mockBackend, renderWithProviders, report, status } from "@/test/ipc";

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

    await user.click(await screen.findByRole("button", { name: "Pause tracking" }));

    expect(await screen.findByRole("button", { name: "Resume tracking" })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Pause tracking" })).toBeEnabled();
  });

  it("disables pause while idle or asleep", async () => {
    mockBackend({
      get_status: () => status({ state: "idle", current: null, since: null }),
      get_report: () => report(),
    });
    renderWithProviders(<TrackingPopoverContainer />);

    expect(await screen.findByText("You seem to be away.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause tracking" })).toBeDisabled();
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
    await screen.findByRole("button", { name: "Pause tracking" });

    await act(async () => {
      await emit("tracking-status-changed", status({ state: "paused", current: null, since: null }));
    });

    expect(await screen.findByRole("button", { name: "Resume tracking" })).toBeInTheDocument();
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

  describe("focus session", () => {
    const slack = { app_id: "com.tinyspeck.slackmacgap", app_name: "Slack", activity_id: 3 };

    it("shows the running session with its countdown and no extras", async () => {
      const now = Date.now();
      mockBackend({
        get_status: () => status(),
        get_report: () => report(),
        focus_status: () => idleFocus({ active: focusActive({ started_at: now - 10 * 60_000, planned_end: now + 23 * 60_000 }) }),
      });
      renderWithProviders(<TrackingPopoverContainer />);

      const card = await screen.findByRole("region", { name: "Active timer" });
      expect(within(card).getByText("Write report")).toBeInTheDocument();
      expect(within(card).getByTestId("focus-countdown")).toHaveTextContent(/^(22|23):\d\d$/);
      expect(within(card).getByText("Focus")).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: "Pause" })).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: "+5 min" })).toBeInTheDocument();
      expect(within(card).queryByText(/Allowed:/)).not.toBeInTheDocument();
    });

    it("shows the drift card with the three actions, and acts on them", async () => {
      const user = userEvent.setup();
      const now = Date.now();
      const { calls } = mockBackend({
        get_status: () => status(),
        get_report: () => report(),
        focus_status: () =>
          idleFocus({ active: focusActive({ started_at: now - 600_000, planned_end: now + 600_000, current: slack, alerting: slack }) }),
        focus_allow_app: () => idleFocus(),
        focus_snooze: () => idleFocus(),
        focus_stop: () => idleFocus(),
      });
      renderWithProviders(<TrackingPopoverContainer />);

      const alert = await screen.findByRole("status", { name: "Drift alert" });
      await user.click(within(alert).getByRole("button", { name: "Allow this app" }));
      await waitFor(() => expect(calls.some((c) => c.cmd === "focus_allow_app" && c.args.appId === slack.app_id)).toBe(true));
    });

    it("ends the session from the popover", async () => {
      const user = userEvent.setup();
      const now = Date.now();
      const { calls } = mockBackend({
        get_status: () => status(),
        get_report: () => report(),
        focus_status: () => idleFocus({ active: focusActive({ started_at: now - 600_000, planned_end: now + 600_000 }) }),
        focus_stop: () => idleFocus(),
      });
      renderWithProviders(<TrackingPopoverContainer />);

      await user.click(await screen.findByRole("button", { name: "End" }));
      await waitFor(() => expect(calls.some((c) => c.cmd === "focus_stop")).toBe(true));
    });

    it("pauses and resumes the countdown", async () => {
      const user = userEvent.setup();
      const now = Date.now();
      let paused_at: number | null = null;
      const { calls } = mockBackend({
        get_status: () => status(),
        get_report: () => report(),
        focus_status: () => idleFocus({ active: focusActive({ started_at: now - 600_000, planned_end: now + 600_000, paused_at }) }),
        focus_pause: () => {
          paused_at = now;
          return idleFocus({ active: focusActive({ started_at: now - 600_000, planned_end: now + 600_000, paused_at }) });
        },
        focus_resume: () => {
          paused_at = null;
          return idleFocus({ active: focusActive({ started_at: now - 600_000, planned_end: now + 600_000 }) });
        },
      });
      renderWithProviders(<TrackingPopoverContainer />);

      await user.click(await screen.findByRole("button", { name: "Pause" }));
      const card = await screen.findByRole("region", { name: "Active timer" });
      expect(await within(card).findByText("· Paused")).toBeInTheDocument();
      expect(within(card).getByRole("timer")).toHaveAccessibleName(/^Paused, 10 minutes left$/);
      await user.click(within(card).getByRole("button", { name: "Resume" }));
      await waitFor(() => expect(calls.map((c) => c.cmd).filter((c) => c.startsWith("focus_p") || c.startsWith("focus_r"))).toEqual(["focus_pause", "focus_resume"]));
    });

    it("starts a timer in one click, with an optional task", async () => {
      const user = userEvent.setup();
      const { calls } = mockBackend({
        get_status: () => status(),
        get_report: () => report(),
        focus_start: () => idleFocus({ active: focusActive({ kind: "timer" }) }),
      });
      renderWithProviders(<TrackingPopoverContainer />);

      const start = await screen.findByRole("region", { name: "Start a timer" });
      await user.type(within(start).getByRole("textbox", { name: "Task (optional)" }), "Read the doc");
      await user.click(within(start).getByRole("button", { name: "50 min" }));
      await waitFor(() =>
        expect(calls.filter((c) => c.cmd === "focus_start").map((c) => c.args.start)).toEqual([
          { kind: "timer", intent: "Read the doc", planned_minutes: 50, allowed: { activity_ids: [], app_ids: [] } },
        ]),
      );
      expect(await screen.findByRole("region", { name: "Active timer" })).toBeInTheDocument();
    });

    it("shows the end card and answers it", async () => {
      const user = userEvent.setup();
      const card = {
        finished: { kind: "focus" as const, intent: "Write report", planned_ms: 25 * 60_000, long_break: false },
        ended_at: Date.now(),
        next: { kind: "break" as const, intent: "", planned_ms: 5 * 60_000, long_break: false },
      };
      const { calls } = mockBackend({
        get_status: () => status(),
        get_report: () => report(),
        focus_status: () => idleFocus({ card, cycle: { enabled: true, round: 1, every: 4 } }),
        focus_card_action: () => idleFocus(),
      });
      renderWithProviders(<TrackingPopoverContainer />);

      const end = await screen.findByRole("region", { name: "Block finished" });
      expect(within(end).getByRole("heading", { name: "Focus done" })).toBeInTheDocument();
      expect(within(end).getByText("Take a 5-minute break?")).toBeInTheDocument();
      expect(within(end).getByRole("img", { name: "1 of 4 blocks before the long break" })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Start a timer" })).not.toBeInTheDocument();
      await user.click(within(end).getByRole("button", { name: "Start break" }));
      await waitFor(() =>
        expect(calls.filter((c) => c.cmd === "focus_card_action").map((c) => c.args.action)).toEqual([{ kind: "start_next" }]),
      );
    });

    it("does not show the end summary (Today and Focus do)", async () => {
      mockBackend({
        get_status: () => status(),
        get_report: () => report(),
        focus_status: () => idleFocus({ unseen: focusSession() }),
      });
      renderWithProviders(<TrackingPopoverContainer />);

      await screen.findByRole("region", { name: "Top apps today" });
      expect(screen.queryByRole("region", { name: "Session summary" })).not.toBeInTheDocument();
    });

    it("keeps working when the focus status cannot be read", async () => {
      mockBackend({
        get_status: () => status(),
        get_report: () => report(),
        focus_status: () => {
          throw { kind: "internal", message: "boom" };
        },
      });
      renderWithProviders(<TrackingPopoverContainer />);

      await screen.findByRole("region", { name: "Top apps today" });
      expect(screen.queryByRole("region", { name: "Active timer" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Start a timer" })).not.toBeInTheDocument();
    });
  });
});
