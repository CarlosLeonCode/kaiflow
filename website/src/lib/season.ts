/**
 * Seasonal ambience windows. Pure functions so they can be tested without a browser; the
 * ambience script calls them with the visitor's local date and `location.search`.
 */
export type Season = "halloween" | "christmas" | "valentine";

const SEASONS: readonly Season[] = ["halloween", "christmas", "valentine"];

/** Month (1-12) and day packed as `month * 100 + day`, so windows compare as plain numbers. */
const dayKey = (date: Date): number => (date.getMonth() + 1) * 100 + date.getDate();

/**
 * The season for a date, using its local calendar day. Windows are inclusive:
 * Halloween Oct 15 – Nov 2, Christmas Dec 1 – Jan 6 (wraps New Year), Valentine's Feb 1 – 15.
 */
export function seasonFor(date: Date): Season | null {
  const key = dayKey(date);
  if (key >= 1015 && key <= 1102) return "halloween";
  if (key >= 1201 || key <= 106) return "christmas";
  if (key >= 201 && key <= 215) return "valentine";
  return null;
}

/**
 * The season to show. `?season=halloween|christmas|valentine` previews one outside its window
 * and `?season=none` turns the ambience off; any other value falls back to the calendar.
 */
export function currentSeason(search: string, date: Date = new Date()): Season | null {
  const override = new URLSearchParams(search).get("season");
  if (override === "none") return null;
  if (override && (SEASONS as readonly string[]).includes(override)) return override as Season;
  return seasonFor(date);
}
