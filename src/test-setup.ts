import "@testing-library/jest-dom/vitest";

import { clearMocks } from "@tauri-apps/api/mocks";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom has no ResizeObserver; Radix form controls (radio groups inside a <form>) measure with it.
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup();
  clearMocks();
  document.documentElement.classList.remove("dark");
});
