import { mockIPC } from "@tauri-apps/api/mocks";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import type {
  FocusDto,
  ReportDto,
  SettingsDto,
  TrackingStatusDto,
} from "@/shared/ipc";
import { AppProviders, createQueryClient } from "@/shared/app/AppProviders";

export const FIXED_NOW = Date.UTC(2026, 9, 20, 12, 0, 0);

export function focus(overrides: Partial<FocusDto> = {}): FocusDto {
  return { app_id: "com.apple.dt.Xcode", app_name: "Xcode", window_title: "AppDelegate.swift", ...overrides };
}

export function status(overrides: Partial<TrackingStatusDto> = {}): TrackingStatusDto {
  return {
    state: "running",
    current: focus(),
    since: FIXED_NOW - 5 * 60_000,
    degraded: false,
    degraded_reason: null,
    shortcut: { kind: "registered", shortcut: "⌃⌥⌘T" },
    ...overrides,
  };
}

export function report(overrides: Partial<ReportDto> = {}): ReportDto {
  return { by_app: [], by_category: [], by_bucket: [], total_ms: 0, ...overrides };
}

export function settings(overrides: Partial<SettingsDto> = {}): SettingsDto {
  return {
    store_titles: true,
    idle_threshold_secs: 300,
    idle_prompt_timeout_secs: 600,
    retention_days: null,
    theme: "system",
    autostart: false,
    shortcut: "⌃⌥⌘T",
    onboarding_completed: true,
    tray_display: "today_total",
    ...overrides,
  };
}

/** What the backend answers to `settings_update`: stored settings with the non-null patch fields applied. */
export function mergePatch(patch: unknown, base: SettingsDto = settings()): SettingsDto {
  const changes = Object.fromEntries(
    Object.entries(patch as Record<string, unknown>).filter(([, value]) => value !== null),
  );
  return { ...base, ...changes } as SettingsDto;
}

export type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

export interface Call {
  cmd: string;
  args: Record<string, unknown>;
}

/**
 * Mocks the Tauri IPC with one handler per command (Tauri's `mockIPC`) and records every
 * call. Unknown commands reject so a missing mock fails loudly. Events are mocked too.
 */
export function mockBackend(handlers: Handlers): { calls: Call[] } {
  const calls: Call[] = [];
  mockIPC(
    (cmd, args) => {
      if (cmd.startsWith("plugin:event|")) return undefined;
      const payload = (args ?? {}) as Record<string, unknown>;
      calls.push({ cmd, args: payload });
      const handler = handlers[cmd] ?? (cmd === "settings_get" ? () => settings() : undefined);
      if (!handler) throw new Error(`unmocked command: ${cmd}`);
      return handler(payload);
    },
    { shouldMockEvents: true },
  );
  return { calls };
}

/** Renders inside the real providers with a retry-free query client. */
export function renderWithProviders(ui: ReactElement) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return { client, ...render(<AppProviders client={client}>{ui}</AppProviders>) };
}
