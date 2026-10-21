import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineItemDto } from "@/shared/ipc";
import { HOUR, MINUTE } from "@/shared/lib/time";
import { focusActive, focusSession, goalStatus, idleFocus, mockBackend, renderWithProviders, report, status } from "@/test/ipc";

import { TodayContainer } from "./TodayContainer";

const at = (h: number, m = 0) => new Date(2026, 9, 20, h, m).getTime();

let nextId = 0;
function item(start: number, end: number, overrides: Partial<TimelineItemDto> = {}): TimelineItemDto {
  nextId += 1;
  return {
    segment_id: nextId,
    start,
    end,
    app_id: "com.apple.dt.Xcode",
    app_name: "Xcode",
    window_title: "AppDelegate.swift",
    activity_id: 2,
    activity_name: "Work",
    activity_color: "#2f7de1",
    source: "tracked",
    end_reason: "focus_change",
    open: false,
    ...overrides,
  };
}

const work = { activity_id: 2, name: "Work", color: "#2f7de1" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(2026, 9, 20, 15, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("TodayContainer", () => {
  it("shows focused time, totals by app and by activity (R7.1)", async () => {
    mockBackend({
      get_status: () => status({ state: "paused", current: null, since: null }),
      get_report: () =>
        report({
          total_ms: 3 * HOUR,
          by_app: [
            { app_id: "com.apple.dt.Xcode", app_name: "Xcode", total_ms: 2 * HOUR },
            { app_id: "com.apple.Safari", app_name: "Safari", total_ms: HOUR },
          ],
          by_activity: [
            { ...work, total_ms: 2 * HOUR },
            { activity_id: 1, name: "Unassigned", color: "#9ca3af", total_ms: HOUR },
          ],
        }),
      get_timeline: () => [item(at(9), at(11)), item(at(11), at(12), { app_id: "com.apple.Safari", app_name: "Safari", activity_id: 1, activity_name: "Unassigned", activity_color: "#9ca3af" })],
    });
    renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);

    await waitFor(() => expect(screen.getByTestId("today-total")).toHaveTextContent("3:00:00"));
    const apps = screen.getByRole("list", { name: "Time by app" });
    expect(within(apps).getAllByRole("button")).toHaveLength(2);
    expect(within(apps).getByText("2h 00m")).toBeInTheDocument();
    const activities = screen.getByRole("list", { name: "Time by activity" });
    expect(within(activities).getByText("Work")).toBeInTheDocument();
    expect(within(activities).getByText("Unassigned")).toBeInTheDocument();
    expect(within(activities).getByText("67%")).toBeInTheDocument();
  });

  it("draws the timeline as an accessible SVG with one block per segment", async () => {
    mockBackend({
      get_status: () => status({ state: "paused", current: null, since: null }),
      get_report: () => report({ total_ms: 2 * HOUR, by_app: [], by_activity: [] }),
      get_timeline: () => [item(at(9), at(10)), item(at(10), at(11), { app_name: "Safari", app_id: "com.apple.Safari" })],
    });
    const { container } = renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);

    const timeline = await screen.findByRole("img", { name: /Timeline of today: 2 blocks/ });
    expect(timeline.tagName.toLowerCase()).toBe("svg");
    expect(container.querySelectorAll("svg rect title")).toHaveLength(2);
    const labels = Array.from(container.querySelectorAll("svg rect title")).map((t) => t.textContent);
    expect(labels).toEqual(["Xcode, Work, 1h 00m", "Safari, Work, 1h 00m"]);
  });

  it("expands an app to its window titles and renders them as literal text (R7.3)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const hostile = '<img src=x onerror="alert(1)">';
    mockBackend({
      get_status: () => status({ state: "paused", current: null, since: null }),
      get_report: () =>
        report({
          total_ms: HOUR,
          by_app: [{ app_id: "com.apple.Safari", app_name: "Safari", total_ms: HOUR }],
          by_activity: [{ ...work, total_ms: HOUR }],
        }),
      get_timeline: () => [
        item(at(9), at(9, 40), { app_id: "com.apple.Safari", app_name: "Safari", window_title: hostile }),
        item(at(9, 40), at(10), { app_id: "com.apple.Safari", app_name: "Safari", window_title: null }),
      ],
    });
    const { container } = renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);

    const toggle = await screen.findByRole("button", { name: /Safari/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const titles = screen.getByRole("list", { name: "Window titles in Safari" });
    expect(within(titles).getByText(hostile)).toBeInTheDocument();
    expect(within(titles).getByText("No window title")).toBeInTheDocument();
    expect(within(titles).getByText("40m")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(hostile)).toBeNull();
  });

  it("separates focused from away time", async () => {
    mockBackend({
      get_status: () => status({ state: "paused", current: null, since: null }),
      get_report: () => report({ total_ms: 2 * HOUR, by_app: [], by_activity: [{ ...work, total_ms: 2 * HOUR }] }),
      get_timeline: () => [
        item(at(9), at(10), { end_reason: "idle" }),
        item(at(10, 30), at(11, 30)),
      ],
    });
    renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);

    const summary = await screen.findByRole("region", { name: "Focused and away time" });
    expect(within(summary).getByText("Focused").nextSibling).toHaveTextContent("2h 00m");
    expect(within(summary).getByText("Away").nextSibling).toHaveTextContent("30m");
    expect(within(summary).getByRole("img", { name: "Focused 2h 00m, away 30m" })).toBeInTheDocument();
  });

  it("explains an empty day (R7 scenario)", async () => {
    mockBackend({
      get_status: () => status({ state: "running" }),
      get_report: () => report(),
      get_timeline: () => [],
    });
    renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);

    expect(await screen.findByText("Nothing tracked yet today")).toBeInTheDocument();
    expect(screen.getByText(/Tracking is on/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Time by app" })).toBeNull();
  });

  it("tells the user to start tracking when it is not running", async () => {
    mockBackend({
      get_status: () => status({ state: "stopped", current: null, since: null }),
      get_report: () => report(),
      get_timeline: () => [],
    });
    renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);

    expect(await screen.findByText(/Tracking is not running/)).toBeInTheDocument();
  });

  it("offers to start tracking from the empty state", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = mockBackend({
      get_status: () => status({ state: "stopped", current: null, since: null }),
      get_report: () => report(),
      get_timeline: () => [],
      start: () => status({ state: "running" }),
    });
    renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);

    await user.click(await screen.findByRole("button", { name: "Start tracking" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "start")).toBe(true));
  });

  it("reports a failed load instead of an empty day", async () => {
    mockBackend({
      get_status: () => status(),
      get_report: () => {
        throw { kind: "storage", message: "database is locked" };
      },
      get_timeline: () => [],
    });
    renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("database is locked");
  });

  it("grows live while recording without extra IPC calls (R7.4)", async () => {
    const open = item(at(14), at(14, 59), { open: true });
    const { calls } = mockBackend({
      get_status: () => status({ state: "running" }),
      get_report: () =>
        report({
          total_ms: HOUR,
          by_app: [{ app_id: "com.apple.dt.Xcode", app_name: "Xcode", total_ms: HOUR }],
          by_activity: [{ ...work, total_ms: HOUR }],
        }),
      get_timeline: () => [open],
    });
    renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("today-total")).toHaveTextContent("1:00:"));
    const before = calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * MINUTE);
    });

    expect(screen.getByTestId("today-total")).toHaveTextContent("1:10:");
    expect(within(screen.getByRole("list", { name: "Time by app" })).getByText("1h 10m")).toBeInTheDocument();
    expect(calls.length).toBe(before);
  });

  it("refetches the timeline when the backend reports new data", async () => {
    let rows: TimelineItemDto[] = [item(at(9), at(10))];
    const { calls } = mockBackend({
      get_status: () => status({ state: "paused", current: null, since: null }),
      get_report: () => report({ total_ms: HOUR, by_app: [], by_activity: [] }),
      get_timeline: () => rows,
    });
    renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);
    await screen.findByRole("img", { name: /1 block,/ });

    rows = [item(at(9), at(10)), item(at(10), at(11))];
    await act(async () => {
      await emit("data-changed", { kind: "segments" });
    });

    expect(await screen.findByRole("img", { name: /2 blocks/ })).toBeInTheDocument();
    expect(calls.filter((c) => c.cmd === "get_timeline").length).toBeGreaterThan(1);
  });

  describe("goals strip", () => {
    const tracked = {
      get_status: () => status({ state: "paused", current: null, since: null }),
      get_report: () => report({ total_ms: HOUR, by_app: [], by_activity: [{ ...work, total_ms: HOUR }] }),
      get_timeline: () => [item(at(9), at(10))],
    };

    it("invites the user to create a goal when there are none, and opens Goals", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockBackend({ ...tracked, goals_status: () => [] });
      let opened = 0;
      renderWithProviders(<TodayContainer onOpenGoals={() => (opened += 1)} />);

      const strip = await screen.findByRole("region", { name: "Goals" });
      expect(within(strip).getByText("No goals yet")).toBeInTheDocument();
      await user.click(within(strip).getByRole("button", { name: "Create a goal" }));
      expect(opened).toBe(1);
    });

    it("shows progress, streak and the alert of a crossed limit", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { calls } = mockBackend({
        ...tracked,
        goals_status: () => [
          goalStatus({ streak: { current: 3, best: 3, at_risk: false } }, { id: 1 }),
          goalStatus(
            { state: "exceeded", unseen: "exceeded", actual_ms: 2 * HOUR, target_ms: HOUR, percent: 200 },
            { id: 2, label: "Mail limit", kind: "maximum", target_ms: HOUR, scope: { kind: "app", app_id: "mail" } },
          ),
        ],
        goal_events_mark_seen: () => null,
      });
      renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);

      const strip = await screen.findByRole("region", { name: "Goals" });
      const rows = within(strip).getAllByRole("listitem");
      // The unseen crossing comes first.
      expect(within(rows[0]!).getByText("Mail limit")).toBeInTheDocument();
      expect(within(rows[0]!).getByTestId("goal-badge")).toHaveTextContent("Limit passed");
      expect(within(rows[1]!).getByText("Streak: 3 days in a row")).toBeInTheDocument();
      await user.click(within(rows[0]!).getByRole("button", { name: "Dismiss the alert for Mail limit" }));
      await waitFor(() => expect(calls.some((c) => c.cmd === "goal_events_mark_seen")).toBe(true));
    });

    it("keeps the bars moving while recording, without extra IPC calls", async () => {
      const open = item(at(14), at(14, 59), { open: true });
      const { calls } = mockBackend({
        get_status: () => status({ state: "running" }),
        get_report: () => report({ total_ms: HOUR, by_app: [], by_activity: [{ ...work, total_ms: HOUR }] }),
        get_timeline: () => [open],
        // The goal counts the activity of the open segment (Work, id 2).
        goals_status: () => [goalStatus({ actual_ms: HOUR, percent: 25 }, { id: 1 })],
      });
      renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);
      const bar = await screen.findByRole("progressbar");
      expect(bar).toHaveAttribute("aria-label", expect.stringContaining("1h of 4h"));
      const before = calls.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * MINUTE);
      });

      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-label", expect.stringContaining("1h 30m of 4h"));
      expect(calls.length).toBe(before);
    });

    it("does not repeat the invitation on an empty day without goals", async () => {
      mockBackend({
        get_status: () => status({ state: "running" }),
        get_report: () => report(),
        get_timeline: () => [],
        goals_status: () => [],
      });
      renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);

      expect(await screen.findByText("Nothing tracked yet today")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Create a goal" })).not.toBeInTheDocument();
    });
  });

  describe("focus session", () => {
    const tracked = {
      get_status: () => status({ state: "paused", current: null, since: null }),
      get_report: () => report({ total_ms: HOUR, by_app: [], by_activity: [{ ...work, total_ms: HOUR }] }),
      get_timeline: () => [item(at(9), at(10))],
      goals_status: () => [],
    };

    it("shows the running session above the day, with its countdown", async () => {
      const now = Date.now();
      mockBackend({
        ...tracked,
        focus_status: () => idleFocus({ active: focusActive({ started_at: now - 10 * MINUTE, planned_end: now + 40 * MINUTE }) }),
      });
      renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);

      const card = await screen.findByRole("region", { name: "Active timer" });
      expect(within(card).getByText("Write report")).toBeInTheDocument();
      expect(within(card).getByTestId("focus-countdown")).toHaveTextContent("40:00");
      // On an empty day too.
    });

    it("shows the session on an empty day as well", async () => {
      const now = Date.now();
      mockBackend({
        get_status: () => status({ state: "running" }),
        get_report: () => report(),
        get_timeline: () => [],
        goals_status: () => [],
        focus_status: () => idleFocus({ active: focusActive({ started_at: now - MINUTE, planned_end: now + 24 * MINUTE }) }),
      });
      renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);

      expect(await screen.findByRole("region", { name: "Active timer" })).toBeInTheDocument();
      expect(screen.getByText("Nothing tracked yet today")).toBeInTheDocument();
    });

    it("shows how the last session went until it is dismissed", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      let unseen: ReturnType<typeof focusSession> | null = focusSession();
      const { calls } = mockBackend({
        ...tracked,
        focus_status: () => idleFocus({ unseen }),
        focus_summary_dismiss: () => {
          unseen = null;
          return idleFocus();
        },
      });
      renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);

      const summary = await screen.findByRole("region", { name: "Session summary" });
      expect(within(summary).getByTestId("summary-headline")).toHaveTextContent("75%");
      await user.click(within(summary).getByRole("button", { name: "Done" }));
      await waitFor(() => expect(screen.queryByRole("region", { name: "Session summary" })).not.toBeInTheDocument());
      expect(calls.some((c) => c.cmd === "focus_summary_dismiss")).toBe(true);
    });

    it("shows nothing without a session", async () => {
      mockBackend(tracked);
      renderWithProviders(<TodayContainer onOpenGoals={() => {}} />);

      await screen.findByText("Focused time");
      expect(screen.queryByRole("region", { name: "Active timer" })).not.toBeInTheDocument();
    });
  });
});
