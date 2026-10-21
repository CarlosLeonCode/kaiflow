-- Goals on tracked time (scope: one activity, one app or everything) and the log of the
-- thresholds they crossed. Additive: nothing existing is touched.
CREATE TABLE goals(
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('activity','app','total')),
  -- Deleting an activity deletes the goals that target it.
  activity_id INTEGER REFERENCES activities(id) ON DELETE CASCADE,
  app_id TEXT,
  period TEXT NOT NULL CHECK(period IN ('daily','weekly','monthly')),
  kind TEXT NOT NULL CHECK(kind IN ('minimum','maximum')),
  target_ms INTEGER NOT NULL CHECK(target_ms > 0),
  -- Bit 0 = Monday .. bit 6 = Sunday; only daily goals use it.
  active_days INTEGER NOT NULL DEFAULT 127 CHECK(active_days BETWEEN 1 AND 127),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0, 1)),
  created_at INTEGER NOT NULL,
  CHECK(
    (scope_kind = 'activity' AND activity_id IS NOT NULL AND app_id IS NULL) OR
    (scope_kind = 'app' AND app_id IS NOT NULL AND activity_id IS NULL) OR
    (scope_kind = 'total' AND activity_id IS NULL AND app_id IS NULL)
  )
);

-- One row per goal, period and kind: the primary key is what makes a notification fire once
-- per period (INSERT OR IGNORE). `period_start` is the local day number (days since
-- 1970-01-01) of the first day of the period.
CREATE TABLE goal_events(
  goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  period_start INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('reached','exceeded')),
  at INTEGER NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0 CHECK(notified IN (0, 1)),
  seen INTEGER NOT NULL DEFAULT 0 CHECK(seen IN (0, 1)),
  PRIMARY KEY(goal_id, period_start, kind)
);
