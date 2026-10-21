-- Categories become activities (goals-and-insights, unit U1). Forward-only; the runner takes a
-- `.bak-v1` copy first and rolls the whole migration back if any statement fails.

-- The v1 trigger references the old table name, which RENAME TABLE would refuse to rewrite.
DROP TRIGGER trg_categories_protect_system;

ALTER TABLE categories RENAME TO activities;
ALTER TABLE category_rules RENAME TO activity_rules;
-- RENAME COLUMN also rewrites the FK targets and CHECK expressions that mention the column.
ALTER TABLE segments RENAME COLUMN category_id TO activity_id;
ALTER TABLE activity_rules RENAME COLUMN category_id TO activity_id;

-- `idle_gaps.status` carries a CHECK with the old `assign_category` literal, which a column
-- rename cannot touch: rebuild the (small) table with the new literal.
CREATE TABLE idle_gaps_new(
  id INTEGER PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  prev_app_id TEXT,
  prev_app_name TEXT,
  prev_title TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','discard','assign_previous','assign_activity','expired')),
  activity_id INTEGER REFERENCES activities(id) ON DELETE SET NULL,
  expires_at INTEGER NOT NULL,
  resolved_at INTEGER
);
INSERT INTO idle_gaps_new(id, started_at, ended_at, prev_app_id, prev_app_name, prev_title,
                          status, activity_id, expires_at, resolved_at)
SELECT id, started_at, ended_at, prev_app_id, prev_app_name, prev_title,
       CASE status WHEN 'assign_category' THEN 'assign_activity' ELSE status END,
       category_id, expires_at, resolved_at
FROM idle_gaps;
DROP TABLE idle_gaps;
ALTER TABLE idle_gaps_new RENAME TO idle_gaps;

ALTER TABLE activities ADD COLUMN productivity TEXT NOT NULL DEFAULT 'neutral'
  CHECK(productivity IN ('productive','neutral','distracting'));
ALTER TABLE activities ADD COLUMN preset_key TEXT;

-- Fixed system activity (domain::UNASSIGNED = id 1); never deletable.
CREATE TRIGGER trg_activities_protect_system BEFORE DELETE ON activities
WHEN OLD.id = 1
BEGIN
  SELECT RAISE(ABORT, 'the system activity cannot be deleted');
END;

-- Only rename the system row when it still has the seeded default name and the new name is free.
UPDATE activities SET name = 'Unassigned'
WHERE id = 1 AND name = 'Sin categoría'
  AND NOT EXISTS (SELECT 1 FROM activities WHERE name = 'Unassigned');

-- Bounds range queries from below (the existing `ix_seg_start` only bounds them from above).
CREATE INDEX ix_seg_end ON segments(ended_at);
