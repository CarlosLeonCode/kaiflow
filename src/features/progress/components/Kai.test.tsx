import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LanguageContext } from "@/shared/i18n/context";

import { Kai, type KaiPose } from "./Kai";

const LABELS: Record<KaiPose, string> = {
  hello: "Kai waving, holding the vermilion dot",
  focus: "Kai focusing with a vermilion headband",
  done: "Kai celebrating inside the open ensō",
  rest: "Kai asleep, hugging the dot",
};

describe("Kai", () => {
  it.each(Object.entries(LABELS) as [KaiPose, string][])("draws the %s pose on its pop stage", (pose, label) => {
    const { container } = render(<Kai pose={pose} />);
    const svg = screen.getByRole("img", { name: label });
    expect(svg).toHaveAttribute("data-pose", pose);
    expect(svg.querySelectorAll("path, ellipse, circle").length).toBeGreaterThan(5);
    expect(container.firstElementChild).toHaveClass("rounded-card", "border-mark-stroke");
  });

  it("stands on the pose's pop by default, or on the one given", () => {
    const { container, rerender } = render(<Kai pose="focus" />);
    expect(container.firstElementChild).toHaveClass("bg-pop-sky");
    rerender(<Kai pose="focus" tone="pink" />);
    expect(container.firstElementChild).toHaveClass("bg-pop-pink");
  });

  it("holds the dot and the open ensō in the done pose", () => {
    const { container } = render(<Kai pose="done" />);
    const enso = container.querySelector("path")!;
    expect(enso.getAttribute("transform")).toContain("scale(1.632)");
    expect(container.querySelector('circle[cx="34.7"]')).toHaveStyle({ fill: "var(--now-dot)" });
  });

  it("hides from assistive technology with an empty label", () => {
    const { container } = render(<Kai pose="rest" label="" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps its size between 44 and 160 px, and fits the round badge", () => {
    const { container, rerender } = render(<Kai pose="hello" size={20} />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "44");
    rerender(<Kai pose="hello" size={400} />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "160");
    rerender(<Kai pose="focus" frame="badge" />);
    expect(container.firstElementChild).toHaveClass("rounded-full", "size-11");
  });

  it("pops in once only when asked", () => {
    const { container, rerender } = render(<Kai pose="hello" />);
    expect(container.querySelector("svg")?.getAttribute("class")).not.toContain("animate");
    rerender(<Kai pose="hello" animate />);
    expect(container.querySelector("svg")).toHaveClass("motion-safe:animate-kf-pop");
  });

  it("speaks Spanish", () => {
    render(
      <LanguageContext.Provider value="es">
        <Kai pose="focus" />
      </LanguageContext.Provider>,
    );
    expect(screen.getByRole("img", { name: "Kai concentrado, con una cinta bermellón" })).toBeInTheDocument();
  });
});
