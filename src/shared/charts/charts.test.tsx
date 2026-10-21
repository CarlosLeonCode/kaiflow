import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { HOUR, MINUTE } from "@/shared/lib/time";

import { Heatmap } from "./Heatmap";
import { RatioBar, ratioText } from "./RatioBar";
import { StackedBars } from "./StackedBars";
import { TrendLine, type TrendPoint } from "./TrendLine";
import type { Bar } from "./types";

const cells = (values: Record<number, number>) => Array.from({ length: 7 * 24 }, (_, i) => values[i] ?? 0);

describe("Heatmap", () => {
  it("is a grid of 7 rows by 24 columns with one labeled cell each and a single tab stop on the busiest cell", () => {
    render(<Heatmap cells={cells({ 33: 2 * HOUR })} label="Tracked time by weekday and hour" />);

    const grid = screen.getByRole("grid", { name: "Tracked time by weekday and hour" });
    expect(within(grid).getAllByRole("row")).toHaveLength(7);
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(168);
    // Index 33 = Tuesday (row 1), 9 o'clock.
    const busiest = within(grid).getByRole("gridcell", { name: /Tuesday, 9 AM: 2h 00m/ });
    expect(busiest).toHaveAttribute("tabindex", "0");
    expect(within(grid).getAllByRole("gridcell").filter((c) => c.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(within(grid).getByRole("gridcell", { name: /Monday, 12 AM: nothing tracked/ })).toBeInTheDocument();
  });

  it("moves between cells with the arrow keys, Home and End", async () => {
    const user = userEvent.setup();
    render(<Heatmap cells={cells({ 33: HOUR })} label="Heatmap" />);
    const cell = (name: RegExp) => screen.getByRole("gridcell", { name });

    act(() => cell(/Tuesday, 9 AM/).focus());
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(cell(/Tuesday, 10 AM/));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(cell(/Wednesday, 10 AM/));
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(cell(/Monday, 10 AM/));
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(cell(/Monday, 10 AM/));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(cell(/Monday, 11 PM/));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(cell(/Monday, 12 AM/));
  });

  it("offers the same numbers as a table for screen readers, only for hours with time", () => {
    render(<Heatmap cells={cells({ 0: 30 * MINUTE, 25: HOUR })} label="Heatmap" />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("Tuesday")).toBeInTheDocument();
  });

  it("renders an empty week without a tab-stop crash", () => {
    render(<Heatmap cells={cells({})} label="Heatmap" />);
    expect(screen.getAllByRole("gridcell").filter((c) => c.getAttribute("tabindex") === "0")).toHaveLength(1);
  });
});

const points = (totals: number[]): TrendPoint[] =>
  totals.map((totalMs, i) => ({ key: i, label: `Day ${i + 1}`, axis: String(i + 1), totalMs }));

describe("TrendLine", () => {
  it("is one labeled image that summarizes the peak, plus a data table", () => {
    render(<TrendLine points={points([HOUR, 3 * HOUR, 0])} label="Tracked time per day" />);

    expect(
      screen.getByRole("img", { name: "Tracked time per day. 3 points from Day 1 to Day 3. Peak 3h 00m on Day 2." }),
    ).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("Nothing tracked")).toBeInTheDocument();
  });

  it("says so when nothing was tracked and survives a single point", () => {
    const { rerender } = render(<TrendLine points={points([0, 0])} label="Tracked time per day" />);
    expect(screen.getByRole("img", { name: "Tracked time per day. Nothing tracked." })).toBeInTheDocument();
    rerender(<TrendLine points={points([HOUR])} label="Tracked time per day" />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });
});

describe("RatioBar", () => {
  it("names every part with its duration and shows the productive share", () => {
    render(
      <RatioBar
        productiveMs={3 * HOUR}
        neutralMs={HOUR}
        distractingMs={HOUR}
        ratio={{ kind: "ratio", ratio: 0.75 }}
      />,
    );
    expect(screen.getByTestId("focus-ratio")).toHaveTextContent("75%");
    expect(
      screen.getByRole("img", { name: "Productive against distracting time: Productive 3h 00m, Distracting 1h 00m" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Distracting").closest("div")).toHaveTextContent("1h 00m");
    expect(screen.getByTestId("neutral-time")).toHaveTextContent("Neutral: 1h 00m");
  });

  it("draws the bar from productive and distracting time only, so the bar matches the headline", () => {
    const { container, rerender } = render(
      <RatioBar productiveMs={HOUR} neutralMs={9 * HOUR} distractingMs={0} ratio={{ kind: "ratio", ratio: 1 }} />,
    );
    expect(screen.getByTestId("focus-ratio")).toHaveTextContent("100%");
    let rects = container.querySelectorAll("svg rect");
    expect(rects).toHaveLength(1);
    expect(rects[0]).toHaveAttribute("width", "100");

    rerender(
      <RatioBar productiveMs={3 * HOUR} neutralMs={9 * HOUR} distractingMs={HOUR} ratio={{ kind: "ratio", ratio: 0.75 }} />,
    );
    rects = container.querySelectorAll("svg rect");
    expect(rects).toHaveLength(2);
    expect(rects[0]).toHaveAttribute("width", "75");
    expect(rects[1]).toHaveAttribute("x", "75");
    expect(rects[1]).toHaveAttribute("width", "25");
  });

  it("explains the missing signal instead of showing a number", () => {
    render(<RatioBar productiveMs={0} neutralMs={2 * HOUR} distractingMs={0} ratio={{ kind: "no_signal" }} />);
    expect(screen.getByTestId("focus-ratio")).toHaveTextContent("No productive or distracting data");
    expect(screen.getByText(/Mark activities as productive or distracting/)).toBeInTheDocument();
    expect(screen.getByTestId("neutral-time")).toHaveTextContent("Neutral: 2h 00m");
  });

  it("formats the ratio", () => {
    expect(ratioText({ kind: "ratio", ratio: 0.666 })).toBe("67%");
    expect(ratioText({ kind: "ratio", ratio: null })).toBeNull();
    expect(ratioText({ kind: "no_signal" })).toBeNull();
  });
});

describe("StackedBars", () => {
  const bars: Bar[] = [
    {
      range: { from: 0, to: 1 },
      label: "Mon",
      fullLabel: "Monday, October 19",
      totalMs: HOUR,
      segments: [{ key: "a", name: "Work", color: "#3b82f6", ms: HOUR }],
    },
    { range: { from: 1, to: 2 }, label: "Tue", fullLabel: "Tuesday, October 20", totalMs: 0, segments: [] },
  ];

  it("carries the data in a visually hidden table too", () => {
    render(<StackedBars bars={bars} dark={false} label="Tracked time per day" />);
    const table = screen.getByRole("table", { name: "Tracked time per day" });
    expect(within(table).getByRole("row", { name: /Monday, October 19 1h 00m Work 1h 00m/ })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /Tuesday, October 20 Nothing tracked/ })).toBeInTheDocument();
  });
});
