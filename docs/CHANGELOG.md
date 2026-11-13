# Changelog

## Unreleased

- Added append-only successful source-check history for live Enka and KQM index fetches, including checked time, content hash, and upstream revision; coverage now distinguishes unknown, active, and pending-review versions without inventing a freshness threshold.
- Added a character data scope matrix that maps identity, stats, talents, mechanics, progression, and recommendations to distinct source roles and approval rules.
- Added `/api/v1/game-data/coverage` and source-catalog UI status showing which registered sources have adapters and approved records.
- Added a KQM TCL character-reference index adapter with fixed-source HTML fetching, layout validation, source URL retention, content-hash versioning, draft preview, and explicit approval.
- Kept KQM index coverage distinct from the game character roster and from character-specific build recommendations; added source-coverage UI and API routes.
- Added a user-triggered Enka static avatar-catalog adapter with a fixed upstream URL, response-size/time limits, schema checks, normalized fields, content-hash versions, source provenance, draft preview, and explicit transactional approval.
- Added an offline Genshin-DB English character snapshot importer with bounded gzip/JSON parsing, SHA-256 content versioning, source revision tracking, optional talent/constellation attachment, reviewable record deltas, draft approval, and historical carry-forward.
- Expanded offline candidate ingestion to weapons, artifacts, materials, enemies, domains, crafts, geographies, and achievements, with per-category change counts, local read endpoints, and carry-forward of omitted categories.
- Added a paginated local catalog browser for approved Genshin-DB category records, preserving the source JSON for inspection.
- Added an offline Enka `locs.json` import with multilingual map normalization, versioned transactional review/approval, retained omitted labels, and exact-hash display-name resolution for the static avatar catalog.
- Added a read-only character reconciliation report using exact numeric IDs first and unique normalized English names second, field-level element/weapon/rarity comparisons, ambiguity and unmatched-reference reporting, source version provenance, and a local review panel.
- Added persistent accept/reject/defer identity-link decisions tied to exact dataset-version fingerprints, migration-backed audit history, stale-evidence rejection, and reconciliation review controls.
- Added a deterministic, read-only canonical character projection from accepted links, with corroborated, single-source, conflicting, and unknown field states; conflicts remain unresolved and the view cannot feed authoritative calculations.
- Added immutable, content-addressed canonical projection snapshots with history/list APIs, exact snapshot retrieval, idempotent saves, and local UI controls for saving and inspecting historical projections.
- Added field-level conflict review on accepted identity links: only current observed source values can be selected, defer/revise actions are audited, and adjudicated values remain candidates rather than authoritative game data.
- Added historical comparison for saved canonical projections, matching characters by source record keys and showing source-version, roster, field-state, value, and evidence changes.
- Added full reconciliation report snapshots and comparisons, including unmatched Genshin-DB/Enka candidates, KQM reference coverage, conflict decisions, and field-evidence changes; snapshots are immutable and content-addressed.
- Added offline KQM TCL page evidence extraction for user-staged HTML: section-scoped statements, lists, and tables retain page URLs, content hashes, extraction version, and experimental status; drafts require approval and omitted pages carry forward.
- Added the local import review panel and `npm run game-data:preview` workflow; no snapshot is bundled or claimed as imported.
- Added `game_entities` persistence and an approved catalog endpoint, retaining omitted prior definitions and keeping static game data separate from owned account inventories.
- Added a local UI flow for catalog preview and approval and fixture tests for normalization and ownership separation.
- Recorded that external hosts are unreachable in the current environment; no live catalog data was imported.

## 0.1.0 — 2026-11-12

- Added the project README with run instructions, current capabilities, architecture status, API overview, and privacy limits.
- Replaced the abbreviated implementation plan with 15 ordered product milestones covering the full specification.
- Added a machine-readable multi-source registry for official, Enka, GOOD/Genshin Optimizer, roster-wide KQM, official map, and candidate community catalogs.
- Added an in-app source catalog so users can inspect each source's scope, freshness policy, adapter status, and guardrails.
- Added the initial source-attributed knowledge entry, versioned SQLite catalog, offline keyword search, draft preview/approval, and revision history.
- Added integration coverage for knowledge provenance, unassessed confidence, draft visibility, approval, and historical version retention.
- Connected the local screen to knowledge search, verification filters, entry limitations, and source links.
- Added a local dataset preview/review/approval panel and carry-forward behavior so omitted knowledge entries remain in the new active version.
- New bundled dataset versions now remain drafts when an approved version already exists.
- Added a shared account input parser and typed API envelope/account models under the contracts package; the server now uses the shared parser.
- Added tracked empty dataset, cache, database, and backup directories to match the monorepo layout.
- Created the empty-workspace GenshinDex monorepo foundation.
- Documented architecture, stack/dependency plan, API, schema strategy, security, offline operation and roadmap.
- Added SQLite migrations, account endpoints, persisted background jobs, worker progress, and SSE.
- Added a dependency-free local account setup/status screen, loopback security baseline, Windows launcher and health/integrity scripts.
- Added smoke/integration coverage for account persistence and UID uniqueness, background jobs, request guards, static screen serving, and host/origin validation.
- Exercised the Windows launcher end to end; it waits on the IPv4 loopback health check, serves the foundation page, and shuts down cleanly.
- Added a reduced-motion override to the foundation screen and removed footer tagline text to keep the product name as the only footer identity.
- Recorded the package-registry restriction and built-in Node runtime adapter.
