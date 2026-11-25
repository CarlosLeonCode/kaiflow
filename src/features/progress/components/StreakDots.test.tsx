import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LanguageContext } from "@/shared/i18n/context";

import { StreakDots } from "./StreakDots";

const WEEK = ["W", "T", "F", "S", "S", "M", "T"];

function states(container: HTMLElement) {
  return [...container.querySelectorAll("i")].map((dot) => dot.getAttribute("data-state"));
}

describe("StreakDots", () => {
  it("draws a missed day as a dashed ring, never red", () => {
    const { container } = render(
      <StreakDots last7={[true, false, true, true, true, true, true]} current={5} best={12} weekdays={WEEK} />,
    );
    expect(states(container)).toEqual(["met", "missed", "met", "met", "met", "met", "today-met"]);
    const missed = container.querySelector('[data-state="missed"]')!;
    expect(missed).toHaveClass("border-dashed", "border-seal-locked");
    expect(container.querySelector('[class*="destructive"], [class*="red-"]')).toBeNull();
  });

  it("names the week and the streak", () => {
    render(<StreakDots last7={[true, false, true, true, true, true, true]} current={5} best={12} weekdays={WEEK} />);
    expect(screen.getByRole("img", { name: "Strokes on 6 of the last 7 days" })).toBeInTheDocument();
    expect(screen.getByText("5-day streak")).toBeInTheDocument();
    expect(screen.getByText(/best 12/)).toBeInTheDocument();
  });

  it("rings today in vermilion until a stroke lands, without shaming a zero streak", () => {
    const { container } = render(
      <StreakDots last7={[false, false, false, false, false, false, false]} current={0} best={3} weekdays={WEEK} />,
    );
    expect(states(container).at(-1)).toBe("today-open");
    expect(container.querySelector('[data-state="today-open"]')).toHaveClass("border-now-dot");
    expect(screen.getByText("A streak starts with one stroke")).toBeInTheDocument();
  });

  it("speaks Spanish", () => {
    render(
      <LanguageContext.Provider value="es">
        <StreakDots last7={[true, true, true, true, true, true, true]} current={7} best={7} weekdays={WEEK} />
      </LanguageContext.Provider>,
    );
    expect(screen.getByText("Racha de 7 días")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Trazos en 7 de los últimos 7 días" })).toBeInTheDocument();
  });
});
