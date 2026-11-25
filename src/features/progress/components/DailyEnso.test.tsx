import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { polar, round2, ENSO_RADIUS, ENSO_REST } from "../lib/enso";
import { DailyEnso } from "./DailyEnso";

describe("DailyEnso", () => {
  it("is announced by its label", () => {
    render(<DailyEnso progress={0.35} label="35 of 100 strokes today" />);
    expect(screen.getByRole("img", { name: "35 of 100 strokes today" })).toBeInTheDocument();
  });

  it("is hidden from assistive technology without a label", () => {
    const { container } = render(<DailyEnso progress={0.35} label="" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("draws no ink at 0", () => {
    const { container } = render(<DailyEnso progress={0} label="No strokes yet today" />);
    expect(container.querySelector('[data-part="ink"]')).toBeNull();
  });

  it("rests the dot in the opening when the day is done", () => {
    const { container } = render(<DailyEnso progress={1} label="Today's ensō is done" />);
    const dot = container.querySelector('[data-part="dot"]')!;
    const [cx, cy] = polar(ENSO_RADIUS, ENSO_REST);
    expect(dot).toHaveAttribute("cx", String(round2(cx)));
    expect(dot).toHaveAttribute("cy", String(round2(cy)));
  });

  it("draws in on-pop ink on a pop fill, and springs in only when asked", () => {
    const { container, rerender } = render(<DailyEnso progress={0.5} label="x" onPop />);
    const ink = () => container.querySelector('[data-part="ink"]')!;
    expect(ink()).toHaveClass("fill-on-pop");
    expect(ink().getAttribute("class")).not.toContain("animate-kf-draw");
    rerender(<DailyEnso progress={0.5} label="x" animate />);
    expect(ink()).toHaveClass("fill-enso-stroke", "motion-safe:animate-kf-draw");
  });
});
