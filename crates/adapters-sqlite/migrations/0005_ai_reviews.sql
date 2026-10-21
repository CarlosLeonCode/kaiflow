-- AI weekly reviews: the history of what was asked and answered. Additive: nothing existing
-- is touched. API keys never live here (they stay in the OS keychain).
CREATE TABLE ai_reviews(
  id INTEGER PRIMARY KEY,
  -- The reviewed period as UTC milliseconds [period_start, period_end).
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  -- Human readable label, e.g. "2026-10-12 to 2026-10-18".
  period_label TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('anthropic','gemini','openai','ollama')),
  model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 200),
  -- Whether window titles were part of what was sent.
  included_titles INTEGER NOT NULL CHECK(included_titles IN (0, 1)),
  -- The exact data sent (JSON text) and the JSON answer (plain text wrapped as {"text": ...}
  -- when the model did not follow the schema).
  request_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ok','text_fallback')),
  created_at INTEGER NOT NULL,
  CHECK(period_end > period_start)
);
CREATE INDEX ix_ai_reviews_created ON ai_reviews(created_at);
CREATE INDEX ix_ai_reviews_period ON ai_reviews(period_start);
