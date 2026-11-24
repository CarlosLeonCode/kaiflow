import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { StrokeEntryDto } from "@/shared/ipc";
import { LanguageContext } from "@/shared/i18n/context";

import { StrokeLedger } from "./StrokeLedger";

const ENTRIES: StrokeEntryDto[] = [
  { source: "focus_completed", strokes: 10, at: 1 },
  { source: "focus_on_target", strokes: 5, at: 2 },
  { source: "focus_completed", strokes: 10, at: 3 },
  { source: "break_taken", strokes: 3, at: 4 },
];

describe("StrokeLedger", () => {
  it("lists how today's strokes were earned, with the total", () => {
    render(<StrokeLedger entries={ENTRIES} total={28} done={false} />);
    const list = screen.getByRole("list", { name: "How today's strokes were earned" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Focus sessions×2+20",
      "Stayed on target×1+5",
      "Took the break×1+3",
      "Today28",
    ]);
  });

  it("ends with Done for today once the ensō is full", () => {
    render(<StrokeLedger entries={ENTRIES} total={100} done />);
    expect(screen.getAllByRole("listitem").at(-1)).toHaveTextContent("Done for today");
  });

  it("says so when nothing was earned yet", () => {
    render(<StrokeLedger entries={[]} total={0} done={false} />);
    expect(screen.getByText("No strokes yet today")).toBeInTheDocument();
  });

  it("speaks Spanish", () => {
    render(
      <LanguageContext.Provider value="es">
        <StrokeLedger entries={ENTRIES} total={28} done={false} />
      </LanguageContext.Provider>,
    );
    expect(screen.getByRole("list", { name: "Cómo conseguiste los trazos de hoy" })).toHaveTextContent(
      "Sesiones de enfoque×2+20",
    );
    expect(screen.getByText("Hoy")).toBeInTheDocument();
  });
});
