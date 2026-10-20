/**
 * The backend stores two system names in Spanish (the migration seeds "Sin categoría" and
 * the report labels manual assignments "Asignado manualmente"). The UI is English, so the
 * display name is derived from the stable identity (id 1 / null app), never from the text.
 */

/** Id of the system category that cannot be deleted (migration 0001). */
export const UNCATEGORIZED_ID = 1;

export const MANUAL_APP_LABEL = "Assigned manually";
export const UNCATEGORIZED_LABEL = "Uncategorized";
export const NO_TITLE_LABEL = "No window title";

export function categoryLabel(id: number, name: string): string {
  return id === UNCATEGORIZED_ID ? UNCATEGORIZED_LABEL : name;
}

export function appLabel(appId: string | null, name: string | null): string {
  return appId === null ? MANUAL_APP_LABEL : (name ?? appId);
}
