# Character data collection scope

## Goal

Build a local, versioned character dataset that can support roster pages, progression plans, build profiles, and later deterministic combat calculations. “All characters” means the canonical set of playable character variants for a selected game-data release. It does not mean every NPC, event-only trial actor, or every text string published on the internet.

Do not use a chat model as the runtime calculator. Web research can find and compare source material; the application must store the accepted inputs and execute versioned code with reproducible results.

## Field groups and source roles

| Field group | Primary collection input | Cross-check / contextual source | Acceptance rules |
|---|---|---|---|
| Stable IDs, element, weapon type, rarity, icon identifiers | Enka static game-data store; extracted client tables | Genshin-DB and official character announcements | Preserve raw IDs and source fields; names and playable status remain unknown until separately reconciled |
| Localized names and descriptions | Enka localization mapping or game text maps | Official character pages/notices | Store language and exact source revision; no guessed name fallback |
| Base growth and ascension stats | Extracted client tables | Genshin-DB normalized data | Preserve level/ascension breakpoints and units; validate tables against independent source or observed in-game values |
| Talent levels and multipliers | Extracted client tables | Genshin-DB for data-shape comparison; KQM TCL for mechanics and testing notes | Store the exact talent level, hit sequence, scaling stat, and game-data version; do not treat guide DPS assumptions as multipliers |
| Passives, constellations, special resources | Client tables and official descriptions | Per-character KQM guide/TCL page | Separate text descriptions from executable mechanics; unsupported conditional behavior stays marked unavailable |
| Ascension/talent materials | Structured game-data tables | Official announcements and current community catalogs | Every material ID and recipe has its own provenance and game-version applicability |
| Build recommendations, weapons, artifacts, teams, rotations, investment | That character’s KQM guide when available | Other named theorycrafting sources and Genshin Optimizer comparisons | Store per-character/per-guide revision, assumptions, author attribution, and coverage; no transfer from one character to another |
| Combat behavior (ICD, gauge, snapshotting, reactions) | Mechanic-specific evidence and reference tests | KQM TCL evidence, independent tests, official descriptions for stated behavior | Keep formulas separate from character datasets; experimental/conflicting states cannot enter authoritative results |
| Banner, challenge, and release rules | Official dated/versioned announcements | Historical snapshots and community archive for discovery | Official rules are authoritative for published rules; retain date and applicable version/cycle |

## Source treatment

- **HoYoverse official pages/notices:** primary evidence for what HoYoverse publishes and dated event/challenge rules. They are not assumed to document hidden mechanics or expose a complete structured database.
- **Enka static store:** structured IDs, mapping fields, and icon/localization references. It is not official, not player inventory, and not by itself a confirmed playable-roster list.
- **GenshinData extracted tables:** useful low-level structured game data for stats and talent curves. Treat as a community-maintained extraction, pin its revision, retain raw records, and cross-check important fields.
- **Genshin-DB:** broad normalized candidate catalog. Its README describes multiple upstreams and version-sensitive data formats; use it for discovery and cross-checking, not automatic promotion to verified.
- **KeqingMains character guides:** recommendations and analysis are character-specific. Record each available guide separately with its own assumptions and revision. Missing guide coverage remains missing.
- **KeqingMains Theorycrafting Library:** page-level references and mechanic evidence. Its character index records page presence, not a verified roster or complete build-guide coverage.
- **Genshin Optimizer and GOOD:** inventory format, optimizer behavior, and comparison references. They are not official ground truth for hidden game behavior.
- **Project Amber and other community catalogs:** candidates until field provenance, current-version freshness, and license/reuse terms are reviewed.
- **HoYoLAB interactive map:** reference-only until an allowed structured interface and use terms are established.

## Required provenance per field

Each populated field records source ID, direct URL, publisher, source revision/hash, checked date, applicable game version (or unknown), verification state, confidence (or unknown), and limitations. Conflicting values remain separate source observations until reviewed. Never choose a value silently because one source is easier to parse.

## Release and coverage rules

1. Select a named game-data release and pin exact revisions/hashes for every input source.
2. Form the playable-character candidate set from structured character definitions; require an explicit reviewed mapping for variants such as Traveler elements and alternate costumes.
3. Reconcile aliases across sources with stable IDs. Fuzzy name matches may suggest a link but cannot approve it automatically.
4. Preview added, changed, unresolved, conflicting, stale, and omitted records before approval.
5. Keep unsupported values null/unknown. A missing source field is not zero, false, or proof that a feature does not exist.
6. Keep source observations and approved canonical values versioned so a historical calculation can reproduce its exact inputs.
7. Review license and attribution requirements before bundling upstream data or artwork.

## Current implementation boundary

The Enka static avatar-definition adapter and KQM TCL character-index adapter create reviewable drafts, but neither has imported live records in this environment because outbound requests from the application are denied. A local Enka localization importer accepts staged `store/gi/locs.json`, versions it by content hash, and resolves display names only by exact text-hash match after separate approval. A local Genshin-DB snapshot importer accepts staged English category gzip data, keeps raw fields, and creates a reviewable SQLite draft without outbound network access. It supports characters, optional talents/constellations, weapons, artifacts, materials, enemies, domains, crafts, geographies, and achievements. Static definitions, localizations, KQM index records, and Genshin-DB records remain separate source-specific catalogs. Other listed sources are registered references/candidates and are not claimed to have imported datasets.

### Local Genshin-DB snapshot workflow

The distribution repository documents category-specific gzip files and a `genshin-db.version` file. Stage `english-characters.min.json.gzip` plus optional English files for talents, constellations, weapons, artifacts, materials, enemies, domains, crafts, geographies, and achievements, along with `genshin-db.version`, in `storage/imports/genshin-db/`. Run `npm run game-data:preview`; the importer reads only explicitly allowlisted files from that fixed folder, checks bounded compressed/expanded sizes, and records a SHA-256 content version. Open the app, choose **Refresh local drafts**, inspect character and category-level added/modified/unchanged counts, then approve the snapshot. Previously approved records omitted from the next staged release are carried forward rather than deleted. It never changes account inventory. Genshin-DB documents category-selective gzip distribution and warns that data formats may change between versions ([distribution README](https://github.com/theBowja/genshin-db-dist), [Genshin-DB README](https://github.com/theBowja/genshin-db/blob/main/readme.md)); this importer therefore keeps raw source records in a separate candidate catalog and does not make hidden mechanic formulas authoritative.
