import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Page } from "./page";
import { OverlayTitleBarContext } from "./title-bar";

describe("Page", () => {
  it("makes the title row the drag area under the macOS overlay title bar (the default)", () => {
    render(
      <Page title="Today" subtitle="Your day so far">
        Body
      </Page>,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Today" });
    expect(heading).toHaveAttribute("data-tauri-drag-region");
    expect(heading.closest("header")).toHaveAttribute("data-tauri-drag-region");
    expect(screen.getByText("Your day so far")).toHaveAttribute("data-tauri-drag-region");
  });

  it("leaves the title row alone under a native title bar (Windows, Linux)", () => {
    render(
      <OverlayTitleBarContext value={false}>
        <Page title="Today" subtitle="Your day so far">
          Body
        </Page>
      </OverlayTitleBarContext>,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Today" });
    expect(heading).not.toHaveAttribute("data-tauri-drag-region");
    expect(heading.closest("header")).not.toHaveAttribute("data-tauri-drag-region");
    expect(screen.getByText("Your day so far")).not.toHaveAttribute("data-tauri-drag-region");
  });
});
