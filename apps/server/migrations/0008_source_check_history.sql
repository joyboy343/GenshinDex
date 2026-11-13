CREATE TABLE IF NOT EXISTS source_check_events (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL,
  dataset_key TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  source_revision TEXT,
  content_hash TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('success','failed')),
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_source_check_events_lookup
  ON source_check_events(source_id,dataset_key,checked_at DESC);
