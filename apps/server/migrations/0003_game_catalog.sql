CREATE TABLE IF NOT EXISTS game_entities (
  id TEXT PRIMARY KEY NOT NULL,
  dataset_id TEXT NOT NULL REFERENCES game_datasets(id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  canonical_json TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_revision TEXT,
  completeness TEXT NOT NULL CHECK (completeness IN ('complete','partial','unknown')),
  UNIQUE(dataset_id, entity_type, entity_key)
);

CREATE INDEX IF NOT EXISTS idx_game_entities_type_key ON game_entities(entity_type, entity_key);
