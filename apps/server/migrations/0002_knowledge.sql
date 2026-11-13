CREATE TABLE IF NOT EXISTS game_datasets (
  id TEXT PRIMARY KEY NOT NULL,
  dataset_key TEXT NOT NULL,
  version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draft','approved','superseded')),
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  UNIQUE(dataset_key, version)
);

CREATE TABLE IF NOT EXISTS knowledge_entries (
  id TEXT PRIMARY KEY NOT NULL,
  dataset_id TEXT NOT NULL REFERENCES game_datasets(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  keywords_json TEXT NOT NULL,
  verification_state TEXT NOT NULL CHECK (verification_state IN ('verified','community-confirmed','experimental','conflicting','deprecated')),
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  limitations_json TEXT NOT NULL,
  game_version TEXT,
  UNIQUE(dataset_id, slug)
);

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id TEXT PRIMARY KEY NOT NULL,
  entry_id TEXT NOT NULL REFERENCES knowledge_entries(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  publisher TEXT NOT NULL,
  url TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  source_version TEXT,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS knowledge_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  dataset_id TEXT NOT NULL REFERENCES game_datasets(id) ON DELETE RESTRICT,
  revision_type TEXT NOT NULL CHECK (revision_type IN ('import-preview','approval')),
  occurred_at TEXT NOT NULL,
  details_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_datasets_key_state ON game_datasets(dataset_key, state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_category ON knowledge_entries(category, verification_state);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_entry ON knowledge_sources(entry_id);
