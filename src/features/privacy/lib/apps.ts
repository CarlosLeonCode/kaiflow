import type { Messages } from "@/shared/i18n";
import type { PrivacyRulesDto } from "@/shared/ipc";
import { appName, type AppOption } from "@/shared/lib/apps";

export type PrivacyMode = "exclude" | "redact_title";

export interface PrivacyRow {
  appId: string;
  name: string;
  mode: PrivacyMode;
}

/** Excluded apps first, then redacted ones, each group by display name. */
export function privacyRows(rules: PrivacyRulesDto, apps: readonly AppOption[]): PrivacyRow[] {
  const rows: PrivacyRow[] = [
    ...rules.excluded_apps.map((appId) => ({ appId, name: appName(apps, appId), mode: "exclude" as const })),
    ...rules.redacted_apps.map((appId) => ({ appId, name: appName(apps, appId), mode: "redact_title" as const })),
  ];
  const rank = (mode: PrivacyMode) => (mode === "exclude" ? 0 : 1);
  return rows.sort(
    (a, b) => rank(a.mode) - rank(b.mode) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** A bundle id looks like `com.company.App`: no spaces, at least one dot. Typos are caught early, odd ids still pass. */
export function bundleIdProblem(value: string, t: Messages): string | null {
  const id = value.trim();
  if (id === "") return t.privacy.apps.problems.empty;
  if (/\s/.test(id) || !id.includes(".")) return t.privacy.apps.problems.invalid;
  return null;
}
