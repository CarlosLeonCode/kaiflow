/**
 * Display names of the two system identities. The backend only carries stable identities
 * (activity id 1, `null` app id for time assigned without an app); the UI derives the text
 * from them, so an older database that still stores a different seeded name looks the same.
 */

/** Id of the system activity that cannot be deleted. */
export const UNASSIGNED_ID = 1;

export const MANUAL_APP_LABEL = "Assigned manually";
export const UNASSIGNED_LABEL = "Unassigned";
export const NO_TITLE_LABEL = "No window title";

export function activityLabel(id: number, name: string): string {
  return id === UNASSIGNED_ID ? UNASSIGNED_LABEL : name;
}

export function appLabel(appId: string | null, name: string | null): string {
  return appId === null ? MANUAL_APP_LABEL : (name ?? appId);
}
