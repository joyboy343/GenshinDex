CREATE TABLE IF NOT EXISTS character_reconciliation_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  snapshot_version TEXT NOT NULL UNIQUE CHECK(snapshot_version GLOB 'sha256-*'),
  source_datasets_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_character_reconciliation_snapshots_created
  ON character_reconciliation_snapshots(created_at DESC, id DESC);
