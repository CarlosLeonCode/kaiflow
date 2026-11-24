import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LanguageContext } from "@/shared/i18n/context";

import { StrokesChip } from "./StrokesChip";

describe("StrokesChip", () => {
  it("shows today's strokes on yellow", () => {
    const { container } = render(<StrokesChip strokes={35} cap={100} done={false} />);
    const chip = container.firstElementChild!;
    expect(chip).toHaveTextContent("+35 today");
    expect(chip).toHaveClass("bg-pop-sun");
    expect(chip).toHaveAttribute("data-state", "earning");
  });

  it("turns mint and reads Done today once the ensō is full", () => {
    const { container } = render(<StrokesChip strokes={100} cap={100} done />);
    const chip = container.firstElementChild!;
    expect(chip).toHaveTextContent("Done today");
    expect(chip).toHaveClass("bg-pop-mint");
    expect(chip).toHaveAttribute("data-state", "done");
  });

  it("opens Goals as a named button", async () => {
    const onClick = vi.fn();
    render(<StrokesChip strokes={35} cap={100} done={false} onClick={onClick} />);
    const chip = screen.getByRole("button", { name: "+35 today, open Goals" });
    expect(chip).toHaveAccessibleDescription("35 of 100 strokes today");
    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("speaks Spanish", () => {
    render(
      <LanguageContext.Provider value="es">
        <StrokesChip strokes={100} cap={100} done onClick={() => {}} />
      </LanguageContext.Provider>,
    );
    const chip = screen.getByRole("button", { name: "Listo hoy, abrir Objetivos" });
    expect(chip).toHaveTextContent("Listo hoy");
    expect(chip).toHaveAccessibleDescription("El ensō de hoy está listo");
  });
});
