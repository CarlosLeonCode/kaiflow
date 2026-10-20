-- Initial schema (design section 7). Timestamps are UTC milliseconds.
CREATE TABLE categories(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Fixed system category (domain::UNCATEGORIZED = id 1); never deletable.
INSERT INTO categories(id, name, color, sort_order) VALUES (1, 'Sin categoría', '#9ca3af', 0);

CREATE TRIGGER trg_categories_protect_system BEFORE DELETE ON categories
WHEN OLD.id = 1
BEGIN
  SELECT RAISE(ABORT, 'the system category cannot be deleted');
END;

CREATE TABLE segments(
  id INTEGER PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  heartbeat_at INTEGER NOT NULL,
  app_id TEXT,
  app_name TEXT,
  window_title TEXT,
  end_reason TEXT CHECK(end_reason IN ('focus_change','idle','sleep','lock','pause','stop','shutdown','recovered')),
  source TEXT NOT NULL DEFAULT 'tracked' CHECK(source IN ('tracked','idle_assigned')),
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  CHECK(ended_at IS NULL OR ended_at >= started_at),
  CHECK(source <> 'tracked' OR app_id IS NOT NULL),
  -- Amendment A1: category-assigned idle time may have no app.
  CHECK(source <> 'idle_assigned' OR (end_reason = 'idle' AND (app_id IS NOT NULL OR category_id IS NOT NULL)))
);

CREATE INDEX ix_seg_start ON segments(started_at);
CREATE INDEX ix_seg_app_start ON segments(app_id, started_at);
-- At most one open segment (R1.3).
CREATE UNIQUE INDEX ux_one_open ON segments((1)) WHERE ended_at IS NULL;

CREATE TABLE idle_gaps(
  id INTEGER PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  prev_app_id TEXT,
  prev_app_name TEXT,
  prev_title TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','discard','assign_previous','assign_category','expired')),
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  expires_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE category_rules(
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('app','title')),
  app_id TEXT,
  pattern TEXT,
  priority INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE privacy_rules(
  app_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('exclude','redact_title'))
);

-- Values are JSON text.
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
