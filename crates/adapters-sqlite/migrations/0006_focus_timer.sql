-- Focus timer: plain timers and breaks next to focus blocks, pause and resume, and an optional
-- task name. Additive: existing rows are focus blocks that were never paused.
ALTER TABLE focus_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'focus'
  CHECK(kind IN ('focus','timer','break'));
-- 1 when the block has no task name; `intent` then holds a placeholder (it must not be empty).
ALTER TABLE focus_sessions ADD COLUMN untitled INTEGER NOT NULL DEFAULT 0 CHECK(untitled IN (0, 1));
-- Set while the block is paused; the countdown is frozen at planned_end - paused_at.
ALTER TABLE focus_sessions ADD COLUMN paused_at INTEGER;
-- Time spent in earlier pauses; planned_end already moved by it.
ALTER TABLE focus_sessions ADD COLUMN paused_ms INTEGER NOT NULL DEFAULT 0 CHECK(paused_ms >= 0);
