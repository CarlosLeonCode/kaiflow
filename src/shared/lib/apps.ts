import type { AppTotalDto } from "@/shared/ipc";

export interface AppOption {
  id: string;
  name: string;
}

/**
 * Bundle ids the user can pick: apps seen in a report plus `extraIds` (apps already used by a
 * rule may not have been seen lately; they fall back to their bundle id as a name). Time
 * assigned manually (no app) is not an app.
 */
export function appOptions(byApp: readonly AppTotalDto[], extraIds: readonly string[] = []): AppOption[] {
  const known = new Map<string, string>();
  for (const app of byApp) {
    if (app.app_id !== null) known.set(app.app_id, app.app_name);
  }
  for (const id of extraIds) {
    if (!known.has(id)) known.set(id, id);
  }
  return [...known.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

/** `Slack` when the name is known, the bundle id otherwise. */
export function appName(options: readonly AppOption[], id: string): string {
  return options.find((option) => option.id === id)?.name ?? id;
}

/** Days of history used to suggest apps ("recently seen"). */
export const RECENT_APP_DAYS = 30;
