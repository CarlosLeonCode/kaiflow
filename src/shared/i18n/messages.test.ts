import { describe, expect, it } from "vitest";

import { en } from "./en";
import { es } from "./es";

describe("plurals", () => {
  it("counts discarded breaks in both languages", () => {
    expect(en.today.autoDiscarded(1)).toBe("1 short break discarded today. Change this in Settings, Idle.");
    expect(en.today.autoDiscarded(3)).toBe("3 short breaks discarded today. Change this in Settings, Idle.");
    expect(es.today.autoDiscarded(1)).toBe("1 pausa corta descartada hoy. Cámbialo en Ajustes, Inactividad.");
    expect(es.today.autoDiscarded(3)).toBe("3 pausas cortas descartadas hoy. Cámbialo en Ajustes, Inactividad.");
  });

  it("counts drift alerts in both languages", () => {
    expect([0, 1, 2].map(en.focus.alerts)).toEqual(["No alerts", "1 alert", "2 alerts"]);
    expect([0, 1, 2].map(es.focus.alerts)).toEqual(["Sin avisos", "1 aviso", "2 avisos"]);
  });

  it("agrees streaks with the period in Spanish", () => {
    expect(en.goals.streak(1, "daily")).toBe("1 day in a row");
    expect(en.goals.streak(2, "weekly")).toBe("2 weeks in a row");
    expect(es.goals.streak(1, "daily")).toBe("1 día seguido");
    expect(es.goals.streak(2, "weekly")).toBe("2 semanas seguidas");
    expect(es.goals.best(1, "monthly")).toBe("Mejor: 1 mes");
    expect(es.goals.best(4, "monthly")).toBe("Mejor: 4 meses");
  });
});
