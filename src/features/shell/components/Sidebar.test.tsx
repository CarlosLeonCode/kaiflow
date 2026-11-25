import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Sidebar } from "./Sidebar";

function renderSidebar(os: "macos" | "windows" | "linux") {
  return render(<Sidebar active="today" onSelect={() => {}} status={null} os={os} />);
}

describe("Sidebar", () => {
  it("keeps a draggable strip for the traffic lights on macOS", () => {
    renderSidebar("macos");
    expect(screen.getByTestId("title-bar-strip")).toHaveAttribute("data-tauri-drag-region");
  });

  it.each(["windows", "linux"] as const)("has no title strip or drag region under the native title bar of %s", (os) => {
    const { container } = renderSidebar(os);
    expect(screen.queryByTestId("title-bar-strip")).toBeNull();
    expect(container.querySelector("[data-tauri-drag-region]")).toBeNull();
  });
});
