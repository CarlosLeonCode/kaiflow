/**
 * Display names of the two system identities. The backend only carries stable identities
 * (activity id 1, `null` app id for time assigned without an app); the UI derives the text
 * from them, so an older database that still stores a different seeded name looks the same.
 *
 * The helpers take the active messages (`useT()`); English is the default so callers that are
 * not translated yet keep working.
 */
import { en, type Messages } from "@/shared/i18n/en";

/** Id of the system activity that cannot be deleted. */
export const UNASSIGNED_ID = 1;

/** English names, for code that is not translated yet and for matching user input. */
export const MANUAL_APP_LABEL = en.common.labels.manualApp;
export const UNASSIGNED_LABEL = en.common.labels.unassigned;
export const NO_TITLE_LABEL = en.common.labels.noTitle;

export function activityLabel(id: number, name: string, t: Messages = en): string {
  return id === UNASSIGNED_ID ? t.common.labels.unassigned : name;
}

export function appLabel(appId: string | null, name: string | null, t: Messages = en): string {
  return appId === null ? t.common.labels.manualApp : (name ?? appId);
}
