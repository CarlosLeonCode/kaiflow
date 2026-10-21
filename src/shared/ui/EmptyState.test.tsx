import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("explains the empty section and offers the next step", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <EmptyState title="No activities yet" action={{ label: "Create your first activity", onClick }}>
        Activities group your time.
      </EmptyState>,
    );

    expect(screen.getByRole("heading", { name: "No activities yet" })).toBeInTheDocument();
    expect(screen.getByText("Activities group your time.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create your first activity" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders without an action when there is nothing to do", () => {
    render(<EmptyState title="Nothing here">Come back later.</EmptyState>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
