import { screen } from "@testing-library/dom";
import { describe, expect, it } from "vitest";

describe("test runner smoke", () => {
  it("renders DOM nodes and queries them with Testing Library", () => {
    const button = document.createElement("button");
    button.textContent = "Start";
    document.body.replaceChildren(button);

    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });
});
