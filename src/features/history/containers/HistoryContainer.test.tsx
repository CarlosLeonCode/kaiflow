import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RangeDto, ReportDto } from "@/shared/ipc";
import { HOUR } from "@/shared/lib/time";
import { mockBackend, renderWithProviders, report } from "@/test/ipc";

import { HistoryContainer } from "./HistoryContainer";

const H = HOUR;
const local = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

// Wednesday, October 21, 2026, noon (local). The week runs Mon Oct 19 .. Mon Oct 26.
const NOW = local(2026, 10, 21, 12);
const WEEK = { from: local(2026, 10, 19), to: local(2026, 10, 26) };
const PREVIOUS_WEEK = { from: local(2026, 10, 12), to: local(2026, 10, 19) };

const WORK = { category_id: 2, name: "Work", color: "#3b82f6" };
const UNCAT = { category_id: 1, name: "Sin categoría", color: "#6b7280" };

const weekReport: ReportDto = report({
  total_ms: 3 * H,
  by_app: [
    { app_id: "com.apple.dt.Xcode", app_name: "Xcode", total_ms: 2 * H },
    { app_id: "com.tinyspeck.slackmacgap", app_name: "Slack", total_ms: H },
  ],
  by_category: [
    { ...WORK, total_ms: 2.5 * H },
    { ...UNCAT, total_ms: 0.5 * H },
  ],
});

const dayReports = new Map<number, ReportDto>([
  [
    local(2026, 10, 19),
    report({ total_ms: 2 * H, by_category: [{ ...WORK, total_ms: 1.5 * H }, { ...UNCAT, total_ms: 0.5 * H }] }),
  ],
  [local(2026, 10, 20), report({ total_ms: H, by_category: [{ ...WORK, total_ms: H }] })],
]);

function backend(overrides: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  return mockBackend({
    get_report: (args) => {
      const range = args.range as RangeDto;
      if (range.from === WEEK.from && range.to === WEEK.to) return weekReport;
      if (range.from === PREVIOUS_WEEK.from) return report({ total_ms: 2 * H });
      return dayReports.get(range.from) ?? report();
    },
    ...overrides,
  });
}

const reportCalls = (calls: { cmd: string; args: Record<string, unknown> }[]) =>
  calls.filter((c) => c.cmd === "get_report").map((c) => c.args as { range: RangeDto; buckets: RangeDto[] });

describe("HistoryContainer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens on the current week with local day boundaries sent as UTC ranges", async () => {
    const { calls } = backend();
    renderWithProviders(<HistoryContainer />);

    expect(await screen.findByTestId("history-total")).toHaveTextContent("3h 00m");
    const sent = reportCalls(calls);
    const main = sent.find((c) => c.range.from === WEEK.from && c.range.to === WEEK.to);
    expect(main?.buckets).toHaveLength(7);
    expect(main?.buckets[0]).toEqual({ from: WEEK.from, to: local(2026, 10, 20) });
    // The previous week and every day (for the stacked bars) are requested too.
    expect(sent.some((c) => c.range.from === PREVIOUS_WEEK.from && c.range.to === PREVIOUS_WEEK.to)).toBe(true);
    for (let day = 19; day <= 25; day += 1) {
      expect(sent.some((c) => c.range.from === local(2026, 10, day) && c.range.to === local(2026, 10, day + 1))).toBe(true);
    }
    expect(screen.getByRole("heading", { level: 2, name: /2026/ })).toBeInTheDocument();
  });

  it("compares with the previous period without relying on color", async () => {
    backend();
    renderWithProviders(<HistoryContainer />);

    const comparison = await screen.findByTestId("history-comparison");
    await waitFor(() => expect(comparison).toHaveTextContent("1h 00m more than the previous week (+50%)"));
  });

  it("draws one accessible bar per day, stacked by category, and moves between bars with the arrow keys", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<HistoryContainer />);

    const chart = await screen.findByRole("group", { name: "Focused time per day, stacked by category" });
    const monday = await within(chart).findByRole("img", { name: /October 19: 2h 00m\. Work 1h 30m, Uncategorized 30m/ });
    expect(within(chart).getAllByRole("img")).toHaveLength(7);
    expect(within(chart).getByRole("img", { name: /October 22: nothing tracked/ })).toBeInTheDocument();
    // Segments are SVG shapes with a title for pointer users.
    expect(monday.querySelectorAll("rect > title")).toHaveLength(2);

    // The chart has a single tab stop: the first day with data.
    expect(monday).toHaveAttribute("tabindex", "0");
    expect(within(chart).getByRole("img", { name: /October 20/ })).toHaveAttribute("tabindex", "-1");
    act(() => monday.focus());
    expect(document.activeElement).toBe(monday);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(within(chart).getByRole("img", { name: /October 20: 1h 00m/ }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(within(chart).getByRole("img", { name: /October 25/ }));
  });

  it("lists totals by category and by app with the Uncategorized name mapped", async () => {
    backend();
    renderWithProviders(<HistoryContainer />);

    const categories = await screen.findByRole("list", { name: "Time by category" });
    expect(within(categories).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Work"),
      expect.stringContaining("Uncategorized"),
    ]);
    const apps = screen.getByRole("list", { name: "Time by app" });
    expect(within(apps).getByText("Xcode")).toBeInTheDocument();
  });

  it("navigates to the previous week and back, never into the future", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<HistoryContainer />);

    await screen.findByTestId("history-total");
    const next = screen.getByRole("button", { name: "Next week" });
    expect(next).toBeDisabled();
    expect(screen.getByRole("button", { name: "Today" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() =>
      expect(reportCalls(calls).some((c) => c.range.from === PREVIOUS_WEEK.from && c.range.to === PREVIOUS_WEEK.to && c.buckets.length === 7)).toBe(true),
    );
    expect(await screen.findByTestId("history-total")).toHaveTextContent("2h 00m");
    // Two weeks back is requested as the comparison base.
    expect(reportCalls(calls).some((c) => c.range.from === local(2026, 10, 5) && c.range.to === local(2026, 10, 12))).toBe(true);
    expect(screen.getByRole("button", { name: "Next week" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(await screen.findByTestId("history-total")).toHaveTextContent("3h 00m");
    expect(screen.getByRole("button", { name: "Next week" })).toBeDisabled();
  });

  it("switches to the day view with hourly buckets and to the month view with daily ones", async () => {
    const user = userEvent.setup();
    const { calls } = backend({
      get_report: (args) => {
        const range = args.range as RangeDto;
        const buckets = args.buckets as RangeDto[];
        if (buckets.length === 24 && range.from === local(2026, 10, 21)) {
          return report({
            total_ms: 90 * 60_000,
            by_bucket: buckets.map((b, i) => ({ range: b, total_ms: i === 9 ? 60 * 60_000 : i === 10 ? 30 * 60_000 : 0 })),
          });
        }
        return report();
      },
    });
    renderWithProviders(<HistoryContainer />);
    await screen.findByTestId("history-total");

    await user.click(screen.getByRole("radio", { name: "Day" }));
    const hourly = await screen.findByRole("group", { name: "Focused time per hour" });
    await waitFor(() => expect(within(hourly).getAllByRole("img")).toHaveLength(24));
    expect(within(hourly).getByRole("img", { name: /9:00 AM: 1h 00m/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous day" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Month" }));
    await waitFor(() =>
      expect(reportCalls(calls).some((c) => c.range.from === local(2026, 10, 1) && c.range.to === local(2026, 11, 1) && c.buckets.length === 31)).toBe(true),
    );
    expect(screen.getByRole("button", { name: "Previous month" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /October 2026/ })).toBeInTheDocument();
  });

  it("exports the visible range as CSV and shows where it was saved (R8.2)", async () => {
    const user = userEvent.setup();
    const { calls } = backend({ export_csv: () => "/Users/me/Downloads/time-track.csv" });
    renderWithProviders(<HistoryContainer />);
    await screen.findByTestId("history-total");

    await user.click(screen.getByRole("button", { name: /Export CSV/ }));

    await waitFor(() => expect(calls.find((c) => c.cmd === "export_csv")?.args).toEqual({ range: WEEK }));
    expect(await screen.findByText("Exported to /Users/me/Downloads/time-track.csv")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Exported to/)).not.toBeInTheDocument();
  });

  it("stays quiet when the save dialog is cancelled and reports failures", async () => {
    const user = userEvent.setup();
    let answer: string | null = null;
    backend({
      export_csv: () => {
        if (answer === null) return null;
        throw { kind: "internal", message: "disk is read-only" };
      },
    });
    renderWithProviders(<HistoryContainer />);
    await screen.findByTestId("history-total");

    await user.click(screen.getByRole("button", { name: /Export CSV/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Export CSV/ })).toBeEnabled());
    expect(screen.queryByText(/Exported to/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    answer = "fail";
    await user.click(screen.getByRole("button", { name: /Export CSV/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not export: disk is read-only");
  });

  it("explains an empty period and still lets the user move on", async () => {
    backend({ get_report: () => report() });
    renderWithProviders(<HistoryContainer />);

    expect(await screen.findByText("Nothing tracked this week")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous week" })).toBeEnabled();
    expect(screen.getByTestId("history-comparison")).toHaveTextContent("Nothing tracked in the previous week either");
  });

  it("shows a loading failure", async () => {
    backend({
      get_report: () => {
        throw { kind: "storage", message: "database is locked" };
      },
    });
    renderWithProviders(<HistoryContainer />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load history: database is locked");
  });
});
