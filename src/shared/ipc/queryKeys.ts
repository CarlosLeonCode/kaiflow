import type { RangeDto, RuleSpecDto } from "./bindings";

/** Every TanStack Query key in one place so events can invalidate them precisely. */
export const queryKeys = {
  status: ["status"] as const,
  settings: ["settings"] as const,
  permission: ["permission"] as const,
  /** OS and display session; fixed for the life of the process. */
  platform: ["platform"] as const,
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
  /** Prefix of every focus query (the status and the history). */
  focus: ["focus"] as const,
  focusStatus: ["focus", "status"] as const,
  focusHistory: ["focus", "history"] as const,
  /** AI settings and the key store state. */
  aiSettings: ["ai", "settings"] as const,
  /** Every stored AI review (the history). */
  aiReviews: ["ai", "reviews"] as const,
  /** One weekly review; under the `report` prefix, so data changes refresh it too. */
  reviewWeek: (weeksAgo: number) => ["report", "review", weeksAgo] as const,
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
  /** What a rule being written would match; under `report`, so data changes refresh it too. */
  rulePreview: (spec: RuleSpecDto, range: RangeDto) =>
    [
      "report",
      "rule-preview",
      spec.kind,
      spec.kind === "app" ? spec.app_id : spec.pattern,
      spec.app_id ?? "",
      range.from,
      range.to,
    ] as const,
  /** Prefix of every timeline query. */
  timelines: ["timeline"] as const,
  timeline: (range: RangeDto) => ["timeline", range.from, range.to] as const,
};
