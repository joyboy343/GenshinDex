# Game data pipeline

## Current implementation

The source registry is in `packages/game-data/src/sources.ts` and is served by `GET /api/v1/sources`. It covers official HoYoverse information, the distinct Enka showcase and static-data scopes, GOOD/Genshin Optimizer, roster-wide KeqingMains guides and TCL, the official map, and candidate community catalogs. Registry membership describes source scope and policy; it does not imply that data has been imported. See [SOURCE_REGISTRY.md](SOURCE_REGISTRY.md).

Three source adapters are implemented: Enka's static avatar definitions and the KQM TCL character-reference page index use fixed upstream URLs; the Genshin-DB character snapshot is imported from a user-staged offline archive. Each produces a SHA-256-versioned draft with source revision/provenance and requires explicit approval. Static definitions, reference-page coverage, and Genshin-DB records are stored as different entity types. KQM index records indicate a page exists; they are not treated as a confirmed playable roster or as full build recommendations. The current environment cannot reach the Enka or KQM upstream at runtime, and no Genshin-DB archive has been staged, so there is no imported live character catalog yet.

KQM page-level evidence can be staged offline under `storage/imports/kqm-tcl/pages/{approved-slug}.html` after the character-reference index is approved. `npm run kqm-pages:preview` validates each H1 against the indexed character and URL, extracts section-scoped prose/list items/tables, hashes the HTML, and creates an experimental draft. No HTML page body is fetched by this command. Approval makes the extracted evidence available for local reference browsing; it remains experimental and calculation-ineligible. Omitted pages carry forward during later dataset approval; reimported pages replace their previous evidence rows. To stage the index itself offline, put the downloaded index at `storage/imports/kqm-tcl/index.html` and run `npm run kqm-index:preview`.

The offline snapshot workflow accepts allowlisted English character, talent, constellation, weapon, artifact, material, enemy, domain, craft, geography, and achievement gzip JSON files from the fixed `storage/imports/genshin-db/` directory. Run `npm run game-data:preview` to validate bounded gzip/JSON input, compute the content hash, compare each supplied category against the currently approved Genshin-DB records, and create a review draft. The local app displays character and category-level record deltas; explicit approval creates a historical approved dataset and carries forward records omitted by a later snapshot. This data is a source-specific candidate catalog, with licensing review pending, and is not promoted into authoritative combat mechanics.

Enka documents `NameTextMapHash` localization lookups through its processed `store/gi/locs.json`. A local importer now accepts this staged file, recognizes hash-first or language-first maps, stores language-tagged labels in a separate versioned draft, and resolves Enka static catalog display names only on exact hash matches after approval. Unmatched hashes remain unresolved. Enka documents the relationship between `NameTextMapHash` and the localization store in its [API localization section](https://github.com/EnkaNetwork/API-docs/blob/master/docs/gi/api.md#localizations) and exposes `locs.json` in the [GI data store](https://github.com/EnkaNetwork/API-docs/tree/master/store/gi).

The first canonical knowledge dataset is `packages/game-data/datasets/knowledge-v0.1.0.json`. It contains one paraphrased general reference about elemental application and internal cooldowns from the [KeqingMains Theorycrafting Library](https://library.keqingmains.com/combat-mechanics/internal-cooldown). The entry is marked `community-confirmed`, leaves numeric confidence unknown, names its source, and says GenshinDex has not tested the current game version. It is reference material only and is not read by a damage calculator. This initial entry is not the character catalog; roster-wide coverage is the ongoing Milestone 2 goal.

At first startup the server validates this bundled file and seeds it into SQLite as a shipped release. If a later application release ships a newer knowledge version, it is stored as `draft`; it does not replace the active knowledge automatically. The knowledge API provides local keyword search, entry/source inspection, version listing, revision history, and draft preview/approval. Search continues using the approved dataset until a user explicitly approves a draft. Approval supersedes the previous version without deleting it and carries forward omitted entries and their source records. Entries omitted from a new version are not interpreted as deletions.

Dataset validation enforces bounded input sizes, unique slugs, supported verification states, confidence in `[0, 1]` or unknown (`null`), HTTPS provenance URLs, and source-check dates. Preview does not fetch submitted URLs, so it cannot cause the server to make arbitrary network requests.

## Pending work

- Remaining source-specific external adapters and terms/licensing review for each source.
- A complete, versioned global catalog for every supported character, weapon, artifact, enemy, and material with per-record provenance.
- Multi-source conflict reports and a review UI.
- Semantic search; current search is the offline keyword fallback.
- Historical dataset comparison and rollback tooling.
- Zod-backed contracts when dependencies can be installed.

Experimental, conflicting, and deprecated records keep visible verification states and do not become authoritative calculation inputs automatically.

Character source comparison rules and API behavior are documented in [SOURCE_RECONCILIATION.md](SOURCE_RECONCILIATION.md).
