# API reference (Foundation and knowledge engine)

Base path: `/api/v1`. Success responses use `{ "data": ... }`; errors use `{ "error": { "code", "message" } }`.

## Game-data catalog

- `GET /api/v1/game-data/characters` returns the approved Enka static avatar-definition catalog. Before first approval it returns an empty catalog and never infers account ownership.
- `GET /api/v1/game-data/characters?lang=en` resolves `displayName` only when an approved Enka localization value matches that record's `nameTextMapHash`; the hash remains in the record.
- `GET /api/v1/game-data/localizations?lang=en` returns the approved localization map for a supported Enka language.
- `GET /api/v1/game-data/localizations/status?lang=en` returns only the approved version and label count.
- `GET /api/v1/game-data/imports/enka-localizations` lists staged localization drafts; `POST /api/v1/game-data/imports/enka-localizations/{draftId}/approve` activates a reviewed draft.
- `POST /api/v1/game-data/characters/preview` with `{}` requests the fixed Enka `store/gi/avatars.json` source and creates a draft identified by a content SHA-256 version. The network request happens only when initiated by the user. Each record retains upstream fields and source revision. Display names remain unresolved until a verified localization adapter is available.
- `POST /api/v1/game-data/characters/datasets/{draftId}/approve` activates a reviewed catalog transactionally. Omitted prior entries carry forward; previous approved datasets remain in history.
- `GET /api/v1/game-data/character-guides` returns the approved KQM Theorycrafting Library character-reference index, separately from canonical character definitions.
- `POST /api/v1/game-data/character-guides/preview` with `{}` requests the KQM index, validates named page links, and creates a content-hash draft. Approval uses `POST /api/v1/game-data/character-guides/datasets/{draftId}/approve`.
- `GET /api/v1/game-data/character-guides/drafts` lists index drafts created by the user-triggered fetch or `npm run kqm-index:preview`; the UI can review and approve either.
- `GET /api/v1/game-data/character-guides/evidence/drafts` lists offline-extracted KQM character-page evidence drafts; `POST /api/v1/game-data/character-guides/evidence/datasets/{draftId}/approve` approves a draft for local browsing.
- `GET /api/v1/game-data/character-guides/evidence?slug=albedo&q=skill&limit=50&offset=0` browses approved extracted statements/tables with source URL, content hash, section path, and experimental verification state.
- `GET /api/v1/game-data/coverage` reports each registered source's adapter status and, where implemented, approved dataset/version/record counts, pending drafts, latest successful live-check timestamp, check age, source revision, content hash, and whether that checked version is active or still awaiting review. Sources without a successful live check report `check-unknown`; local staged imports do not imply a source-check date. Check age is informational and no stale/fresh threshold is inferred.
- `GET /api/v1/game-data/reconciliation/characters?status=all&q=&limit=100&offset=0` returns explainable candidate links and field conflicts across approved Genshin-DB, Enka, and KQM TCL datasets. It never merges or mutates source records.
- `POST /api/v1/game-data/reconciliation/reviews` records an `accepted`, `rejected`, or `deferred` decision for a current match fingerprint; stale evidence is rejected.
- `GET /api/v1/game-data/reconciliation/reviews/{fingerprint}` returns version-bound review history.
- `POST /api/v1/game-data/reconciliation/field-reviews` records a `selected-source` or `deferred` decision for a conflict on an accepted identity link; a selected value must exactly match current source evidence.
- `GET /api/v1/game-data/reconciliation/field-reviews/{fingerprint}` returns append-only history for a field decision.
- `POST /api/v1/game-data/reconciliation/characters/snapshots` with `{}` saves the entire current reconciliation report, including unmatched source records and guide references; identical evidence is deduplicated by content hash.
- `GET /api/v1/game-data/reconciliation/characters/snapshots?limit=25&offset=0` lists report history; `GET /api/v1/game-data/reconciliation/characters/snapshots/{id}` retrieves a saved report.
- `GET /api/v1/game-data/reconciliation/characters/snapshots/compare?from={id}&to={id}` compares candidate coverage, source fields, conflict decisions, and unmatched KQM references across two saved report versions.
- `GET /api/v1/game-data/canonical-characters` computes a versioned candidate projection from accepted identity links; unresolved conflicts remain null and the result is not calculation-eligible.
- `POST /api/v1/game-data/canonical-characters/snapshots` with `{}` stores the current projection by content hash; repeated saves of identical evidence return the existing immutable snapshot.
- `GET /api/v1/game-data/canonical-characters/snapshots?limit=25&offset=0` lists saved projection history; `GET /api/v1/game-data/canonical-characters/snapshots/{id}` retrieves an exact stored projection.
- `GET /api/v1/game-data/canonical-characters/snapshots/compare?from={id}&to={id}` compares two saved projections by stable source-record keys, reporting added/removed characters, source-version changes, and per-field evidence/value/state changes.
- `GET /api/v1/game-data/imports` lists local Genshin-DB snapshot drafts created by `npm run game-data:preview`; approve through `POST /api/v1/game-data/imports/{draftId}/approve`.
- `GET /api/v1/game-data/genshin-db/characters` returns the approved Genshin-DB source-specific records, including the original source fields.
- `GET /api/v1/game-data/genshin-db/{category}?q=...&limit=50&offset=0` returns a paginated approved source-specific category for weapons, artifacts, materials, enemies, domains, crafts, geographies, or achievements. `limit` is capped at 100.

These catalogs are separate from Enka UID showcase data and GOOD account inventory. A static definition does not mean a character is owned, and KQM page presence is not a verified playable-roster count or build recommendation.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Process and database health |
| GET | `/` | Locally served Phase 1 foundation screen |
| GET | `/api/v1/accounts` | List local accounts |
| POST | `/api/v1/accounts` | Create account `{ nickname, server?, uid? }` |
| GET | `/api/v1/sources` | List registered upstream sources, coverage, status, and usage guardrails |
| GET | `/api/v1/game-data/coverage` | Compare the registry with implemented adapters and locally approved records |
| GET | `/api/v1/jobs/:id` | Poll job state |
| GET | `/api/v1/jobs/:id/events` | Stream progress by SSE |
| POST | `/api/v1/jobs/sample` | Start an infrastructure demonstration job |
| POST | `/api/v1/jobs/:id/cancel` | Request cancellation |
| GET | `/api/v1/knowledge?q=...` | Search approved local knowledge by keyword |
| GET | `/api/v1/knowledge/:slug` | Read an entry with sources and limitations |
| GET | `/api/v1/knowledge/datasets` | List dataset versions and states |
| GET | `/api/v1/knowledge/datasets/:id` | Inspect a version, including historical datasets |
| GET | `/api/v1/knowledge/datasets/:id/revisions` | Read dataset preview/approval history |
| POST | `/api/v1/knowledge/datasets/preview` | Validate and save an unapproved draft dataset |
| POST | `/api/v1/knowledge/datasets/:id/approve` | Explicitly approve a draft and supersede the active version |

Mutations require `Content-Type: application/json` and `X-GenshinDex-Request: 1`. Browser origins are limited to the local application origin. APIs bind to IPv4 loopback only. Account request validation and shared response types live in `packages/contracts`; Zod schemas are pending dependency installation. Knowledge updates remain drafts until explicit approval. Search is local keyword search, not semantic search. The sample job demonstrates worker progress plumbing; it is not a game calculation.
