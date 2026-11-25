-- Progress (gamification): the strokes ledger and the seals earned. Local only. Additive:
-- nothing existing is touched. Rolling retention never deletes these rows (all-time levels
-- are computed from them); deleting all data clears them.

-- One row per award. `award_key` (domain `Award::key`) is what makes an award count once.
-- `day` is the local day number (days since 1970-01-01) the award counts toward. `strokes` is
-- what was granted after the daily cap: 0 once the day is full, and the row still counts for
-- seals. `source` is not constrained so a new source needs no table rebuild; readers reject
-- names they do not know.
CREATE TABLE stroke_awards(
  id INTEGER PRIMARY KEY,
  award_key TEXT NOT NULL UNIQUE,
  day INTEGER NOT NULL,
  source TEXT NOT NULL,
  strokes INTEGER NOT NULL CHECK(strokes >= 0),
  earned_at INTEGER NOT NULL
);

CREATE INDEX ix_stroke_day ON stroke_awards(day);

-- One row per seal (domain `Seal::as_str`) ever earned; a seal is never earned twice.
CREATE TABLE seals(
  seal TEXT PRIMARY KEY,
  earned_at INTEGER NOT NULL,
  -- The user acknowledged it.
  seen INTEGER NOT NULL DEFAULT 0 CHECK(seen IN (0, 1))
);
