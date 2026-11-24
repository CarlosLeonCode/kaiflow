import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SealViewDto } from "@/shared/ipc";
import { LanguageContext } from "@/shared/i18n/context";

import { Seal } from "./Seal";
import { SealGrid } from "./SealGrid";

function seal(overrides: Partial<SealViewDto> & Pick<SealViewDto, "id" | "family">): SealViewDto {
  return { earned: true, earned_at: 1, seen: true, current: 1, target: 1, ...overrides };
}

const SEALS: SealViewDto[] = [
  seal({ id: "first_focus", family: "focus" }),
  seal({ id: "seven_days", family: "streaks", seen: false, current: 7, target: 7 }),
  seal({ id: "ten_sessions", family: "focus", earned: false, earned_at: null, seen: false, current: 3, target: 10 }),
  seal({ id: "took_the_break", family: "breaks" }),
  seal({ id: "perfect_week", family: "goals", earned: false, earned_at: null, seen: false, current: 2, target: 7 }),
  seal({ id: "thirty_days", family: "streaks", earned: false, earned_at: null, seen: false, current: 12, target: 30 }),
];

describe("Seal", () => {
  it("draws an earned sticker in its family color, tilted, without a hint", () => {
    const { container } = render(<Seal glyph="dot" tone="sky" state="earned" label="First focus, earned" name="First focus" hint="0 of 1" />);
    expect(screen.getByRole("img", { name: "First focus, earned" })).toHaveClass("-rotate-5");
    expect(container.querySelector('[data-part="disc"]')).toHaveClass("fill-pop-sky", "stroke-mark-stroke");
    expect(screen.queryByText("0 of 1")).not.toBeInTheDocument();
    expect(container.querySelector('[data-part="new"]')).toBeNull();
  });

  it("draws a locked seal as a dashed outline with its hint, untilted", () => {
    const { container } = render(
      <Seal glyph="dotted" tone="sun" state="locked" label="Thirty days, not earned yet" name="Thirty days" hint="12 of 30 days" />,
    );
    const svg = screen.getByRole("img", { name: "Thirty days, not earned yet" });
    expect(svg).not.toHaveClass("-rotate-5");
    const disc = container.querySelector('[data-part="disc"]')!;
    expect(disc).toHaveClass("fill-none", "stroke-seal-locked");
    expect(disc).toHaveAttribute("stroke-dasharray", "4 5");
    expect(screen.getByText("12 of 30 days")).toBeInTheDocument();
  });

  it("carries the vermilion dot while new", () => {
    const { container } = render(<Seal glyph="seven" tone="sun" state="new" label="Seven days, new" />);
    expect(container.querySelector('[data-part="new"]')).toHaveClass("fill-now-dot");
  });
});

describe("SealGrid", () => {
  it("shows earned seals first, then the next locked ones with hints", () => {
    render(<SealGrid seals={SEALS} maxLocked={2} />);
    const names = screen.getAllByRole("img").map((img) => img.getAttribute("aria-label"));
    expect(names).toEqual([
      "First focus, earned",
      "Seven days, new",
      "Took the break, earned",
      "Ten sessions, not earned yet",
      "Perfect week, not earned yet",
    ]);
    expect(screen.getByText("3 of 10 sessions")).toBeInTheDocument();
    expect(screen.getByText("2 of 7 days")).toBeInTheDocument();
  });

  it("speaks Spanish", () => {
    render(
      <LanguageContext.Provider value="es">
        <SealGrid seals={SEALS} />
      </LanguageContext.Provider>,
    );
    expect(screen.getByRole("list", { name: "Sellos" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Siete días, nuevo" })).toBeInTheDocument();
    expect(screen.getByText("12 de 30 días")).toBeInTheDocument();
  });
});
