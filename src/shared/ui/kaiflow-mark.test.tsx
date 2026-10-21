import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KaiflowMark } from "./kaiflow-mark";

describe("KaiflowMark", () => {
  it("is announced as Kaiflow by default", () => {
    render(<KaiflowMark />);
    expect(screen.getByRole("img", { name: "Kaiflow" })).toBeInTheDocument();
  });

  it("is hidden from assistive technology when decorative", () => {
    const { container } = render(<KaiflowMark decorative />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("draws the small cut by default, without the dry-brush mask", () => {
    const { container } = render(<KaiflowMark />);
    expect(container.querySelector("mask")).toBeNull();
  });

  it("gives each detailed instance its own mask id", () => {
    const { container } = render(
      <>
        <KaiflowMark variant="detailed" />
        <KaiflowMark variant="detailed" />
      </>,
    );
    const ids = [...container.querySelectorAll("mask")].map((mask) => mask.id);
    expect(new Set(ids).size).toBe(2);
  });
});
