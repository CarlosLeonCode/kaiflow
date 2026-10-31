/**
 * Tests for the seasonal ambience windows in `src/lib/season.ts`.
 *
 * Node runs the TypeScript module directly through its built-in type stripping, so there is
 * no test runner dependency. Usage (from `website/`): npm run test:season
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { currentSeason, seasonFor } from "../src/lib/season.ts";

/** Local-time date (the ambience uses the visitor's calendar day, not UTC). */
const local = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour);

describe("seasonFor", () => {
  /** @type {Array<[Date, string | null]>} */
  const cases = [
    // Halloween: Oct 15 – Nov 2.
    [local(2026, 10, 14), null],
    [local(2026, 10, 15, 0), "halloween"],
    [local(2026, 10, 31), "halloween"],
    [local(2026, 11, 2, 23), "halloween"],
    [local(2026, 11, 3, 0), null],
    // Christmas: Dec 1 – Jan 6, across the year wrap.
    [local(2026, 11, 30, 23), null],
    [local(2026, 12, 1, 0), "christmas"],
    [local(2026, 12, 31, 23), "christmas"],
    [local(2027, 1, 1, 0), "christmas"],
    [local(2027, 1, 6, 23), "christmas"],
    [local(2027, 1, 7, 0), null],
    // Valentine's: Feb 1 – 15.
    [local(2027, 1, 31, 23), null],
    [local(2027, 2, 1, 0), "valentine"],
    [local(2027, 2, 14), "valentine"],
    [local(2027, 2, 15, 23), "valentine"],
    [local(2027, 2, 16, 0), null],
    // Off season.
    [local(2026, 7, 1), null],
  ];

  for (const [date, expected] of cases) {
    it(`${date.toDateString()} ${date.getHours()}h -> ${expected}`, () => {
      assert.equal(seasonFor(date), expected);
    });
  }
});

describe("currentSeason", () => {
  const offSeason = local(2026, 7, 1);
  const inHalloween = local(2026, 10, 31);

  it("follows the calendar without an override", () => {
    assert.equal(currentSeason("", inHalloween), "halloween");
    assert.equal(currentSeason("", offSeason), null);
  });

  it("previews any season with ?season=", () => {
    assert.equal(currentSeason("?season=christmas", offSeason), "christmas");
    assert.equal(currentSeason("?season=valentine", inHalloween), "valentine");
    assert.equal(currentSeason("?lang=x&season=halloween", offSeason), "halloween");
  });

  it("forces nothing with ?season=none", () => {
    assert.equal(currentSeason("?season=none", inHalloween), null);
  });

  it("ignores unknown values", () => {
    assert.equal(currentSeason("?season=easter", inHalloween), "halloween");
    assert.equal(currentSeason("?season=", offSeason), null);
  });
});
