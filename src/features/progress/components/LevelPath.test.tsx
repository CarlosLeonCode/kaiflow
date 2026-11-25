import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LanguageContext, LocaleContext } from "@/shared/i18n/context";

import { LevelPath } from "./LevelPath";

const flow = { number: 4, name: "flow", total: 2_410, into_level: 410, span: 600, next_name: "craft" } as const;

describe("LevelPath", () => {
  it("shows the level and the distance to the next one", () => {
    render(<LevelPath level={flow} />);
    expect(screen.getByText("Flow")).toBeInTheDocument();
    expect(screen.getByText("410 of 600 strokes to Craft")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Level 4, Flow: 410 of 600 strokes to Craft" })).toBeInTheDocument();
  });

  it("shows the total at the top level", () => {
    render(<LevelPath level={{ number: 7, name: "kaizen", total: 12_500, into_level: 500, span: null, next_name: null }} />);
    expect(screen.getByText("12,500 strokes. The top of the path.")).toBeInTheDocument();
  });

  it("speaks Spanish with Spanish numbers", () => {
    render(
      <LanguageContext.Provider value="es">
        <LocaleContext.Provider value="es">
          <LevelPath level={{ ...flow, number: 5, name: "craft", into_level: 1_250, span: 3_000, next_name: "mastery" }} />
        </LocaleContext.Provider>
      </LanguageContext.Provider>,
    );
    expect(screen.getByText("Oficio")).toBeInTheDocument();
    expect(screen.getByText("1250 de 3000 trazos para Maestría")).toBeInTheDocument();
  });
});
