CREATE TABLE IF NOT EXISTS character_link_reviews (
  fingerprint TEXT PRIMARY KEY NOT NULL CHECK(length(fingerprint) = 64),
  decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected','deferred')),
  note TEXT,
  evidence_json TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS character_link_review_history (
  id TEXT PRIMARY KEY NOT NULL,
  fingerprint TEXT NOT NULL CHECK(length(fingerprint) = 64),
  previous_decision TEXT CHECK(previous_decision IS NULL OR previous_decision IN ('accepted','rejected','deferred')),
  decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected','deferred')),
  note TEXT,
  evidence_json TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_character_link_review_history ON character_link_review_history(fingerprint, changed_at DESC);
