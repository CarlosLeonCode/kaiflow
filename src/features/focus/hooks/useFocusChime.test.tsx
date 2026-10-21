import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { events } from "@/shared/ipc";
import { mockBackend } from "@/test/ipc";

import { useFocusChime } from "./useFocusChime";

describe("useFocusChime", () => {
  it("chimes only when the backend asks for it", async () => {
    mockBackend({});
    const play = vi.fn();
    renderHook(() => useFocusChime(play));
    // Let the subscription settle before emitting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    await events.focusEnded.emit({ kind: "timer", auto_started: false, chime: false });
    await events.focusEnded.emit({ kind: "break", auto_started: false, chime: true });

    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
  });
});
