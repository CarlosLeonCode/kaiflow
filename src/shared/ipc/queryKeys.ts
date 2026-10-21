import type { RangeDto } from "./bindings";

/** Every TanStack Query key in one place so events can invalidate them precisely. */
export const queryKeys = {
  status: ["status"] as const,
  settings: ["settings"] as const,
  permission: ["permission"] as const,
  activities: ["activities"] as const,
  rules: ["rules"] as const,
  presets: ["presets"] as const,
  suggestions: ["suggestions"] as const,
  privacy: ["privacy"] as const,
  idleGaps: ["idle-gaps"] as const,
  backup: ["backup"] as const,
  /** Prefix of every goal query (the list and the progress). */
  goals: ["goals"] as const,
  goalList: ["goals", "list"] as const,
  goalStatus: ["goals", "status"] as const,
  retentionImpact: (days: number | null) => ["retention-impact", days] as const,
  /** The update the backend announced (written by the `update-available` event, never fetched). */
  update: ["update"] as const,
  /** Prefix of every report query (use it to invalidate them all). */
  reports: ["report"] as const,
  report: (range: RangeDto, buckets: readonly RangeDto[] = []) =>
    ["report", range.from, range.to, buckets.map((b) => `${b.from}-${b.to}`).join(",")] as const,
  /** One Overview dashboard; under the `report` prefix, so data changes refresh it too. */
  dashboard: (range: RangeDto, buckets: readonly RangeDto[], previous: RangeDto | null) =>
    [
      "report",
      "dashboard",
      range.from,
      range.to,
      buckets.map((b) => `${b.from}-${b.to}`).join(","),
      previous ? `${previous.from}-${previous.to}` : "none",
    ] as const,
  /** Prefix of every timeline query. */
  timelines: ["timeline"] as const,
  timeline: (range: RangeDto) => ["timeline", range.from, range.to] as const,
};
