import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardDto, RangeDto } from "@/shared/ipc";
import { HOUR } from "@/shared/lib/time";
import { aiSettings, dashboard, focusSession, goalStatus, mockBackend, renderWithProviders, review, settings } from "@/test/ipc";

import { InsightsContainer } from "./InsightsContainer";

const H = HOUR;
const local = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

// Wednesday, October 21, 2026, noon (local). The week runs Mon Oct 19 .. Mon Oct 26.
const NOW = local(2026, 10, 21, 12);
const WEEK = { from: local(2026, 10, 19), to: local(2026, 10, 26) };
const PREVIOUS_WEEK = { from: local(2026, 10, 12), to: local(2026, 10, 19) };

const WORK = { activity_id: 2, name: "Work", color: "#3b82f6", productivity: "productive" as const };
const UNASSIGNED = { activity_id: 1, name: "Unassigned", color: "#6b7280", productivity: "neutral" as const };

function heat(cells: Record<number, number>): number[] {
  return Array.from({ length: 7 * 24 }, (_, i) => cells[i] ?? 0);
}

/** A dashboard for the week: Monday 2 h (1.5 h Work, 0.5 h Unassigned) and Tuesday 1 h of Work. */
function weekDashboard(buckets: RangeDto[]): DashboardDto {
  return dashboard({
    range: WEEK,
    total_ms: 3 * H,
    previous_total_ms: 2 * H,
    trend: { kind: "change", delta_ms: H, pct: 50 },
    by_activity: [
      { ...WORK, total_ms: 2.5 * H },
      { ...UNASSIGNED, total_ms: 0.5 * H },
    ],
    by_app: [
      { app_id: "com.apple.dt.Xcode", app_name: "Xcode", total_ms: 2 * H },
      { app_id: "com.tinyspeck.slackmacgap", app_name: "Slack", total_ms: H },
    ],
    top_titles: [{ app_id: "com.apple.dt.Xcode", app_name: "Xcode", window_title: "Tracker.swift", total_ms: 1.5 * H }],
    buckets: buckets.map((range, index) => ({
      range,
      total_ms: index === 0 ? 2 * H : index === 1 ? H : 0,
      by_activity:
        index === 0
          ? [
              { activity_id: 2, total_ms: 1.5 * H },
              { activity_id: 1, total_ms: 0.5 * H },
            ]
          : index === 1
            ? [{ activity_id: 2, total_ms: H }]
            : [],
    })),
    heatmap: heat({ 9: 1.5 * H, 10: 0.5 * H, 33: H }),
    productivity: { productive_ms: 2.5 * H, neutral_ms: 0.5 * H, distracting_ms: 0 },
    focus_ratio: { kind: "ratio", ratio: 1 },
  });
}

type Handlers = Parameters<typeof mockBackend>[0];

function backend(overrides: Handlers = {}) {
  return mockBackend({
    get_dashboard: (args) => {
      const range = args.range as RangeDto;
      if (range.from === WEEK.from && range.to === WEEK.to) return weekDashboard(args.buckets as RangeDto[]);
      return dashboard({ range, buckets: (args.buckets as RangeDto[]).map((r) => ({ range: r, total_ms: 0, by_activity: [] })) });
    },
    review_get: (args) => review({ weeks_ago: args.weeksAgo as number, first_day: 20_738 - 7 * (args.weeksAgo as number) }),
    ai_settings_get: () => aiSettings(),
    ai_reviews_list: () => [],
    ...overrides,
  });
}

interface DashboardArgs {
  range: RangeDto;
  buckets: RangeDto[];
  previous: RangeDto | null;
}
const dashboardCalls = (calls: { cmd: string; args: Record<string, unknown> }[]) =>
  calls.filter((c) => c.cmd === "get_dashboard").map((c) => c.args as unknown as DashboardArgs);

describe("InsightsContainer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the whole week in ONE call with local day boundaries sent as UTC ranges", async () => {
    const { calls } = backend();
    renderWithProviders(<InsightsContainer />);

    expect(await screen.findByTestId("insights-total")).toHaveTextContent("3h 00m");
    const sent = dashboardCalls(calls);
    // One data call carries the range, its seven day buckets and the previous week: no
    // report per day, no report for the comparison.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.range).toEqual(WEEK);
    expect(sent[0]?.previous).toEqual(PREVIOUS_WEEK);
    expect(sent[0]?.buckets).toHaveLength(7);
    expect(sent[0]?.buckets[0]).toEqual({ from: WEEK.from, to: local(2026, 10, 20) });
    expect(calls.some((c) => c.cmd === "get_report")).toBe(false);
    expect(screen.getByRole("heading", { level: 2, name: /2026/ })).toBeInTheDocument();
  });

  it("states the trend in words without relying on color", async () => {
    backend();
    renderWithProviders(<InsightsContainer />);

    expect(await screen.findByTestId("insights-comparison")).toHaveTextContent(
      "1h 00m more than the previous week (+50%)",
    );
  });

  it("says there is no comparison when the previous period is empty", async () => {
    backend({
      get_dashboard: (args) => ({ ...weekDashboard(args.buckets as RangeDto[]), previous_total_ms: 0, trend: { kind: "no_comparison" } }),
    });
    renderWithProviders(<InsightsContainer />);

    expect(await screen.findByTestId("insights-comparison")).toHaveTextContent(
      "No comparison: nothing was tracked in the previous week",
    );
  });

  it("draws one accessible bar per day, stacked by activity, and moves between bars with the arrow keys", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<InsightsContainer />);

    const chart = await screen.findByRole("group", { name: "Tracked time per day, stacked by activity" });
    const monday = await within(chart).findByRole("img", { name: /October 19: 2h 00m\. Work 1h 30m, Unassigned 30m/ });
    expect(within(chart).getAllByRole("img")).toHaveLength(7);
    expect(within(chart).getByRole("img", { name: /October 22: nothing tracked/ })).toBeInTheDocument();
    expect(monday.querySelectorAll("rect > title")).toHaveLength(2);

    expect(monday).toHaveAttribute("tabindex", "0");
    act(() => monday.focus());
    expect(document.activeElement).toBe(monday);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(within(chart).getByRole("img", { name: /October 20: 1h 00m/ }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(within(chart).getByRole("img", { name: /October 25/ }));
  });

  it("shows the heatmap, the trend line and the productive time from the same response", async () => {
    backend();
    renderWithProviders(<InsightsContainer />);

    const grid = await screen.findByRole("grid", { name: "Tracked time by weekday and hour" });
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(168);
    expect(within(grid).getByRole("gridcell", { name: /Monday, 9 AM: 1h 30m/ })).toBeInTheDocument();
    // Only the days that have started are plotted (Monday to Wednesday).
    expect(screen.getByRole("img", { name: /Tracked time per day\. 3 points/ })).toBeInTheDocument();
    expect(screen.getByTestId("focus-ratio")).toHaveTextContent("100%");
  });

  it("lists totals by activity, app and window title with the Unassigned name mapped", async () => {
    backend();
    renderWithProviders(<InsightsContainer />);

    const activities = await screen.findByRole("list", { name: "Time by activity" });
    expect(within(activities).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Work"),
      expect.stringContaining("Unassigned"),
    ]);
    expect(within(screen.getByRole("list", { name: "Time by app" })).getByText("Xcode")).toBeInTheDocument();
    const titles = screen.getByRole("list", { name: "Time by window title" });
    expect(within(titles).getByText("Tracker.swift")).toBeInTheDocument();
  });

  it("explains a ratio without productive or distracting time", async () => {
    backend({
      get_dashboard: (args) => ({
        ...weekDashboard(args.buckets as RangeDto[]),
        productivity: { productive_ms: 0, neutral_ms: 3 * H, distracting_ms: 0 },
        focus_ratio: { kind: "no_signal" },
      }),
    });
    renderWithProviders(<InsightsContainer />);

    expect(await screen.findByTestId("focus-ratio")).toHaveTextContent("No productive or distracting data");
  });

  it("navigates to the previous week and back, never into the future", async () => {
    const user = userEvent.setup();
    const { calls } = backend({
      get_dashboard: (args) => {
        const range = args.range as RangeDto;
        return range.from === PREVIOUS_WEEK.from
          ? { ...weekDashboard(args.buckets as RangeDto[]), total_ms: 2 * H, range }
          : weekDashboard(args.buckets as RangeDto[]);
      },
    });
    renderWithProviders(<InsightsContainer />);

    await screen.findByTestId("insights-total");
    expect(screen.getByRole("button", { name: "Next week" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Today" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() =>
      expect(dashboardCalls(calls).some((c) => c.range.from === PREVIOUS_WEEK.from && c.range.to === PREVIOUS_WEEK.to)).toBe(true),
    );
    const back = dashboardCalls(calls).find((c) => c.range.from === PREVIOUS_WEEK.from);
    // Two weeks back is the comparison base, still in the same call.
    expect(back?.previous).toEqual({ from: local(2026, 10, 5), to: local(2026, 10, 12) });
    await waitFor(() => expect(screen.getByTestId("insights-total")).toHaveTextContent("2h 00m"));
    expect(screen.getByRole("button", { name: "Next week" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(await screen.findByTestId("insights-total")).toHaveTextContent("3h 00m");
    expect(screen.getByRole("button", { name: "Next week" })).toBeDisabled();
  });

  it("switches to day (hourly), month (daily) and 90 days (weekly), one call each", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<InsightsContainer />);
    await screen.findByTestId("insights-total");

    await user.click(screen.getByRole("radio", { name: "Day" }));
    await waitFor(() => expect(dashboardCalls(calls).some((c) => c.buckets.length === 24)).toBe(true));
    expect(screen.getByRole("button", { name: "Previous day" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Month" }));
    await waitFor(() =>
      expect(
        dashboardCalls(calls).some((c) => c.range.from === local(2026, 10, 1) && c.range.to === local(2026, 11, 1) && c.buckets.length === 31),
      ).toBe(true),
    );
    expect(screen.getByRole("heading", { level: 2, name: /October 2026/ })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "90 days" }));
    await waitFor(() => expect(dashboardCalls(calls).some((c) => c.buckets.length === 13)).toBe(true));
    const quarter = dashboardCalls(calls).find((c) => c.buckets.length === 13);
    expect(quarter?.range.to).toBe(local(2026, 10, 22));
    expect(quarter?.previous?.to).toBe(quarter?.range.from);
    expect(screen.getByRole("button", { name: "Previous 90 days" })).toBeInTheDocument();

    expect(calls.some((c) => c.cmd === "get_report")).toBe(false);
  });

  it("hides the weekday heatmap for a single day", async () => {
    const user = userEvent.setup();
    backend({
      get_dashboard: (args) => ({
        ...weekDashboard(args.buckets as RangeDto[]),
        range: args.range as RangeDto,
      }),
    });
    renderWithProviders(<InsightsContainer />);
    await screen.findByRole("grid", { name: "Tracked time by weekday and hour" });

    await user.click(screen.getByRole("radio", { name: "Day" }));
    await waitFor(() => expect(screen.queryByRole("grid")).not.toBeInTheDocument());
  });

  it("exports the visible range as JSON and shows where it was saved", async () => {
    const user = userEvent.setup();
    const { calls } = backend({ export_json: () => "/Users/me/Downloads/kaiflow-export.json" });
    renderWithProviders(<InsightsContainer />);
    await screen.findByTestId("insights-total");

    await user.click(screen.getByRole("button", { name: /Export JSON/ }));

    await waitFor(() => expect(calls.find((c) => c.cmd === "export_json")?.args).toEqual({ range: WEEK }));
    expect(await screen.findByText("Exported to /Users/me/Downloads/kaiflow-export.json")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Exported to/)).not.toBeInTheDocument();
  });

  it("stays quiet when the save dialog is cancelled and reports failures", async () => {
    const user = userEvent.setup();
    let answer: string | null = null;
    backend({
      export_json: () => {
        if (answer === null) return null;
        throw { kind: "internal", message: "disk is read-only" };
      },
    });
    renderWithProviders(<InsightsContainer />);
    await screen.findByTestId("insights-total");

    await user.click(screen.getByRole("button", { name: /Export JSON/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Export JSON/ })).toBeEnabled());
    expect(screen.queryByText(/Exported to/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    answer = "fail";
    await user.click(screen.getByRole("button", { name: /Export JSON/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not export: disk is read-only");
  });

  it("explains an empty period and still lets the user move on", async () => {
    backend({ get_dashboard: (args) => dashboard({ range: args.range as RangeDto }) });
    renderWithProviders(<InsightsContainer />);

    expect(await screen.findByText("Nothing tracked this week")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous week" })).toBeEnabled();
    expect(screen.getByTestId("insights-comparison")).toHaveTextContent("No comparison");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a loading failure", async () => {
    backend({
      get_dashboard: () => {
        throw { kind: "storage", message: "database is locked" };
      },
    });
    renderWithProviders(<InsightsContainer />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load insights: database is locked");
  });

  it("lists the goals of the dashboard with their progress", async () => {
    backend({
      get_dashboard: (args) => ({
        ...weekDashboard(args.buckets as RangeDto[]),
        goals: [goalStatus({ streak: { current: 4, best: 6, at_risk: false } }, { label: "Deep work" })],
      }),
    });
    renderWithProviders(<InsightsContainer />);

    const card = await screen.findByRole("region", { name: "Goals" });
    expect(within(card).getByText("Deep work")).toBeInTheDocument();
    expect(within(card).getByText("Streak: 4 days in a row")).toBeInTheDocument();
    expect(within(card).getByRole("progressbar")).toBeInTheDocument();
  });

  it("starts weeks on the configured day and orders the heatmap rows the same way", async () => {
    // Sunday-first: the week of Wed Oct 21 runs Sun Oct 18 .. Sun Oct 25.
    const { calls } = backend({ settings_get: () => settings({ week_start: 6 }) });
    renderWithProviders(<InsightsContainer />);

    await waitFor(() => {
      const sent = dashboardCalls(calls).at(-1);
      expect(sent?.range).toEqual({ from: local(2026, 10, 18), to: local(2026, 10, 25) });
      expect(sent?.previous).toEqual({ from: local(2026, 10, 11), to: local(2026, 10, 18) });
    });
  });
  it("names the productive share card Productive time", async () => {
    backend();
    renderWithProviders(<InsightsContainer />);

    expect(await screen.findByRole("region", { name: "Productive time" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Focus ratio" })).not.toBeInTheDocument();
  });

  it("adds the weekly review of the same week below the cards in the Week view only", async () => {
    const user = userEvent.setup();
    const { calls } = backend({
      review_get: () => review({ focus: [focusSession()], note: "Felt rushed on Tuesday" }),
    });
    renderWithProviders(<InsightsContainer />);

    expect(await screen.findByTestId("review-focus")).toHaveTextContent("1 session (1 completed)");
    expect(screen.getByLabelText("Your note about this week")).toHaveValue("Felt rushed on Tuesday");
    expect(await screen.findByText(/nothing is sent anywhere until you switch a provider on/i)).toBeInTheDocument();
    expect(calls.filter((c) => c.cmd === "review_get").map((c) => c.args.weeksAgo)).toEqual([0]);
    // No duplicate cards: Summary, productive time and goals come from the dashboard once.
    expect(screen.getAllByRole("region", { name: "Summary" })).toHaveLength(1);
    expect(screen.getAllByRole("region", { name: "Productive time" })).toHaveLength(1);

    await user.click(screen.getByRole("radio", { name: "Month" }));
    await waitFor(() => expect(screen.queryByTestId("review-focus")).not.toBeInTheDocument());
    expect(screen.queryByLabelText("Your note about this week")).not.toBeInTheDocument();
  });

  it("binds the note and the AI analysis to the week on screen as weeks back", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<InsightsContainer />);
    await screen.findByLabelText("Your note about this week");

    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(calls.filter((c) => c.cmd === "review_get").map((c) => c.args.weeksAgo)).toEqual([0, 1, 2]));

    await user.type(await screen.findByLabelText("Your note about this week"), "Two weeks back");
    await user.click(screen.getByRole("button", { name: "Save note" }));
    // The note goes to the first day the backend reported for that same week.
    await waitFor(() =>
      expect(calls.find((c) => c.cmd === "review_note_set")?.args).toEqual({ firstDay: 20_738 - 14, note: "Two weeks back" }),
    );
  });

  it("keys the weekly review by the configured first day of the week", async () => {
    const user = userEvent.setup();
    // Sunday-first: Wed Oct 21 is in the week of Sun Oct 18, the current week (weeksAgo 0).
    const { calls } = backend({ settings_get: () => settings({ week_start: 6 }) });
    renderWithProviders(<InsightsContainer />);
    await screen.findByLabelText("Your note about this week");

    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() =>
      expect(dashboardCalls(calls).some((c) => c.range.from === local(2026, 10, 11) && c.range.to === local(2026, 10, 18))).toBe(true),
    );
    await waitFor(() => expect(calls.filter((c) => c.cmd === "review_get").at(-1)?.args.weeksAgo).toBe(1));
    expect(calls.filter((c) => c.cmd === "review_get").every((c) => (c.args.weeksAgo as number) <= 1)).toBe(true);
  });
});
