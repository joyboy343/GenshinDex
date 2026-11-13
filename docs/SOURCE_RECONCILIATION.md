# Source reconciliation

## Purpose

Reconciliation is a read-only report over the latest approved Enka static avatar definitions, English Genshin-DB character catalog, Enka localization snapshot, and KQM TCL character-reference index. It creates explainable candidate links; it does not create or update canonical entities.

## Matching rules

1. Match numeric Genshin-DB and Enka IDs exactly when the approved records contain the same numeric ID.
2. If IDs do not match, suggest a link only when the English Genshin-DB name and approved Enka localized name have a unique normalized exact match. Normalization folds case/diacritics and removes punctuation/spacing; it does not use fuzzy similarity or guessed aliases.
3. Duplicate name candidates stay ambiguous. An Enka record without a matching Genshin-DB record stays Enka-only. Missing approved datasets are reported as unknown, not as zero coverage.
4. KQM TCL pages attach by exact normalized English display name and remain reference-coverage links; they do not establish roster membership or validate a build.

## Field comparisons

Only compare element, weapon type, and rarity when both source records have recognized values. Element and weapon enums are mapped through explicit alias tables; unknown enum values are left un-compared. A disagreement is surfaced with the original and normalized values and source identifiers. Names that differ on an ID match are also shown as a name-label difference; this may be an alias or a source mismatch and is not resolved automatically.

Each candidate includes source keys, source URLs/revisions, dataset versions, match explanation, potential matches, comparable fields, conflicts, and any matching KQM page. Candidate links are recomputed from active source snapshots so historical reproductions remain tied to the versions included in the report.

## API

`GET /api/v1/game-data/reconciliation/characters?status=all&q=&limit=100&offset=0`

The response includes source dataset versions, summary counts, candidate records, unmatched KQM reference pages, any saved review state, and the matching policy. `status=conflicts` filters candidates with at least one comparable disagreement. The local screen exposes the same report under **Cross-source character reconciliation**.

For unique ID/name matches, reviewers can set **accepted**, **rejected**, or **deferred**. Decisions are bound to a SHA-256 fingerprint of the Genshin-DB and Enka record keys, both dataset versions, the localization version, and matching method. New source versions therefore require a fresh review. Every change is stored in `character_link_review_history` and the application activity log. Decisions do not rewrite source records or create a canonical roster entry.

`POST /api/v1/game-data/reconciliation/reviews` accepts `{ fingerprint, decision, note? }`. The server recomputes current evidence and rejects stale fingerprints. `GET /api/v1/game-data/reconciliation/reviews/{fingerprint}` returns the local decision history for that exact evidence version.

After accepting an identity link, a reviewer can adjudicate each conflicting field by selecting one of the exact source values currently shown, or defer the field review. `POST /api/v1/game-data/reconciliation/field-reviews` rejects values absent from current evidence. Field decisions bind to the accepted link, field name, source keys/versions, and compared values. `GET /api/v1/game-data/reconciliation/field-reviews/{fingerprint}` returns append-only history. Adjudication updates the candidate projection only; it does not make the chosen source globally authoritative.

`GET /api/v1/game-data/canonical-characters` computes the accepted-link projection. See [CANONICAL_CHARACTER_PROJECTION.md](CANONICAL_CHARACTER_PROJECTION.md) for field-state semantics and history limits.

The full report (including unmatched records and KQM pages) can also be saved and compared independently of canonical projection snapshots. `POST /api/v1/game-data/reconciliation/characters/snapshots` with `{}` saves the current report by content hash. List/retrieve it under `/api/v1/game-data/reconciliation/characters/snapshots`; compare two versions using the `compare?from={id}&to={id}` endpoint. Comparison reports added/removed candidates, status and evidence changes, field conflicts and decisions, source-version changes, and unmatched KQM page changes. It does not rewrite source datasets or review history.
