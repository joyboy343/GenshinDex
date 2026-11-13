CREATE TABLE IF NOT EXISTS canonical_character_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  dataset_version TEXT NOT NULL UNIQUE CHECK(dataset_version GLOB 'sha256-*'),
  source_datasets_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canonical_character_snapshots_created
  ON canonical_character_snapshots(created_at DESC, id DESC);
