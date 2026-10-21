-- Focus sessions: a timed block with an intent and the activities / apps it allows.
-- Additive: nothing existing is touched.
CREATE TABLE focus_sessions(
  id INTEGER PRIMARY KEY,
  intent TEXT NOT NULL CHECK(length(intent) BETWEEN 1 AND 80),
  started_at INTEGER NOT NULL,
  planned_end INTEGER NOT NULL,
  -- NULL while the session runs; a row without ended_at is resumed (or closed) at startup.
  ended_at INTEGER,
  end_reason TEXT CHECK(end_reason IN ('completed','cancelled','recovered')),
  drift_alerts INTEGER NOT NULL DEFAULT 0 CHECK(drift_alerts >= 0),
  -- Summary derived from the tracked segments when the session closes.
  inside_ms INTEGER NOT NULL DEFAULT 0 CHECK(inside_ms >= 0),
  outside_ms INTEGER NOT NULL DEFAULT 0 CHECK(outside_ms >= 0),
  -- JSON array of {app_id, app_name, ms}, most time first.
  distractions TEXT NOT NULL DEFAULT '[]',
  -- The user acknowledged the end summary.
  seen INTEGER NOT NULL DEFAULT 0 CHECK(seen IN (0, 1)),
  CHECK(planned_end > started_at),
  CHECK((ended_at IS NULL) = (end_reason IS NULL)),
  CHECK(ended_at IS NULL OR ended_at >= started_at)
);

-- At most one running session.
CREATE UNIQUE INDEX ux_one_active_focus ON focus_sessions((1)) WHERE ended_at IS NULL;
CREATE INDEX ix_focus_started ON focus_sessions(started_at);

-- What a session allows: an app by its id, or a whole activity.
CREATE TABLE focus_allowed(
  session_id INTEGER NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
  app_id TEXT,
  activity_id INTEGER REFERENCES activities(id) ON DELETE CASCADE,
  CHECK((app_id IS NULL) <> (activity_id IS NULL))
);
CREATE UNIQUE INDEX ux_focus_allowed_app ON focus_allowed(session_id, app_id) WHERE app_id IS NOT NULL;
CREATE UNIQUE INDEX ux_focus_allowed_activity ON focus_allowed(session_id, activity_id) WHERE activity_id IS NOT NULL;
