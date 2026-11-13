CREATE TABLE IF NOT EXISTS character_field_reviews (
  fingerprint TEXT PRIMARY KEY NOT NULL CHECK(length(fingerprint) = 64),
  character_fingerprint TEXT NOT NULL CHECK(length(character_fingerprint) = 64),
  field_name TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('selected-source','deferred')),
  selected_source_id TEXT,
  selected_value_json TEXT,
  note TEXT,
  evidence_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((decision='selected-source' AND selected_source_id IS NOT NULL AND selected_value_json IS NOT NULL) OR (decision='deferred' AND selected_source_id IS NULL AND selected_value_json IS NULL))
);

CREATE TABLE IF NOT EXISTS character_field_review_history (
  id TEXT PRIMARY KEY NOT NULL,
  fingerprint TEXT NOT NULL CHECK(length(fingerprint) = 64),
  character_fingerprint TEXT NOT NULL CHECK(length(character_fingerprint) = 64),
  field_name TEXT NOT NULL,
  previous_decision TEXT CHECK(previous_decision IS NULL OR previous_decision IN ('selected-source','deferred')),
  decision TEXT NOT NULL CHECK(decision IN ('selected-source','deferred')),
  selected_source_id TEXT,
  selected_value_json TEXT,
  note TEXT,
  evidence_json TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_character_field_review_history
  ON character_field_review_history(fingerprint, changed_at DESC);
