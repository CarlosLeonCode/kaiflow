import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MomentDto } from "@/shared/ipc";
import { en, es, type Messages } from "@/shared/i18n";
import { LanguageContext } from "@/shared/i18n/context";

import { momentContent } from "../lib/moment";
import { DailyEnso } from "./DailyEnso";
import { Kai } from "./Kai";
import { MomentCard } from "./MomentCard";
import { Seal } from "./Seal";

function card(moment: MomentDto, t: Messages = en) {
  const content = momentContent(moment, t);
  const drawing =
    moment.kind === "seal" ? (
      <Seal glyph="seven" tone="sun" state="earned" label="" size={60} />
    ) : moment.kind === "level" ? (
      <DailyEnso progress={0.08} size={64} label={t.progress.moment.level.drawing} onPop />
    ) : (
      <Kai pose="done" size={72} frame="none" />
    );
  const onDismiss = vi.fn();
  const onLink = vi.fn();
  const view = (
    <MomentCard
      tone={content.tone}
      drawing={drawing}
      title={content.title}
      sentence={content.sentence}
      link={{ label: content.linkLabel, onClick: onLink }}
      onDismiss={onDismiss}
    />
  );
  return { view, onDismiss, onLink };
}

describe("MomentCard", () => {
  it("celebrates a finished day with Kai and dismisses", async () => {
    const { view, onDismiss, onLink } = card({ kind: "day_done", day: 1 });
    render(view);
    const region = screen.getByRole("region", { name: "Today's ensō is done" });
    expect(region).toHaveAttribute("data-tone", "sun");
    expect(region).toHaveClass("bg-pop-sun", "motion-safe:animate-kf-pop");
    expect(screen.getByText("See you tomorrow.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Kai celebrating inside the open ensō" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "How you earned them" }));
    expect(onLink).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss: Today's ensō is done" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("announces a new seal on pink and dismisses", async () => {
    const { view, onDismiss } = card({ kind: "seal", seal: "seven_days" });
    render(view);
    expect(screen.getByRole("region", { name: "New seal: Seven days" })).toHaveClass("bg-pop-pink");
    expect(screen.getByText("A full week without breaking the streak.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss: New seal: Seven days" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("announces a level on sky and dismisses with the keyboard", async () => {
    const { view, onDismiss } = card({ kind: "level", number: 5, name: "craft" });
    render(view);
    expect(screen.getByRole("region", { name: "Level 5 · Craft" })).toHaveClass("bg-pop-sky");
    expect(screen.getByRole("img", { name: "A new level begins" })).toBeInTheDocument();
    screen.getByRole("button", { name: "Dismiss: Level 5 · Craft" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("speaks Spanish", () => {
    const { view } = card({ kind: "day_done", day: 1 }, es);
    render(<LanguageContext.Provider value="es">{view}</LanguageContext.Provider>);
    expect(screen.getByRole("region", { name: "El ensō de hoy está listo" })).toHaveTextContent("Nos vemos mañana.");
    expect(screen.getByRole("button", { name: "Descartar: El ensō de hoy está listo" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Kai celebrando dentro del ensō abierto" })).toBeInTheDocument();
  });
});
