# Game-data source registry

`packages/game-data/src/sources.ts` is the machine-readable registry returned by `GET /api/v1/sources`. It records what each upstream source can actually provide, its authority class, coverage, update policy, and guardrails. A registry entry does not mean an adapter is implemented or that data has been imported.

## Source roles

| Source | Role | Limits/status |
|---|---|---|
| HoYoverse official site | Primary source for published descriptions, announcements, releases, and event details | Not a complete structured data API; published descriptions do not verify hidden mechanics |
| Enka UID API | User-requested public showcase snapshot | Showcase only; cache by TTL, set a descriptive User-Agent, honor rate limits, never enumerate UIDs |
| Enka game data store/docs | ID, icon, localization, and response-shape mappings used to interpret Enka records | Mapping data is not account inventory; pin revision and review terms before bundling |
| GOOD format | User-provided character, weapon, and artifact inventory interchange | Inventory categories present in a file only; omission is not deletion or proof of zero |
| Genshin Optimizer | GOOD compatibility/schema and optimizer reference | Community implementation; compatibility is not proof of game-mechanic correctness |
| KeqingMains character guides | Per-character builds, weapons, teams, rotations, and investment guidance across the playable roster | Community recommendations; coverage/revision is per guide. Do not transfer a character-specific claim to another character |
| KeqingMains Theorycrafting Library | User-reviewed index of character-reference pages plus mechanics and evidence references | Page presence is not a playable-roster assertion or proof of a full build guide; evidence and freshness vary by page |
| HoYoLAB Interactive Map | Official exploration reference | No supported bulk marker adapter established; use reference-only until data terms/interface are reviewed |
| Project Amber | Candidate structured catalog for cross-checking current entities | Candidate only until freshness, field provenance, and reuse terms are reviewed |
| Genshin-DB | Candidate broad catalog for coverage and cross-source checks | Pin versions and compare patch freshness/provenance before approval |

## Data-source policy

- Every fact or record stores a source URL, publisher, source/data revision, check date, game version where known, verification state, confidence (or unknown), and limitations.
- Official descriptions, player-submitted inventory, character recommendations, empirical mechanic tests, and datamined/structured catalogs remain separate source classes.
- Enka and GOOD answer different account-data questions. Enka showcases do not reveal a player's complete roster or inventory; GOOD can carry a wider inventory supplied by the player but cannot establish game-wide truths.
- KQM is used as a roster-wide guide and theorycrafting organization. Guides are attached to their individual characters and their own revisions; the name is not treated as a single-character scope.
- Conflicting sources remain visible as a conflict. The system does not silently average values or promote a candidate source to verified.
- Source adapters are user-initiated where they access the network, rate-limited, cached, and separated from canonical calculations.
- Successful live fetches are recorded separately from imported/approved datasets, including checked time, content hash, and upstream revision when supplied. Coverage shows the age of the last successful check but does not label a source fresh or stale without a source-specific policy. A locally staged file with no source-check evidence remains `check-unknown`.
- Do not redistribute full upstream catalogs, artwork, map tiles, or guides until the relevant license/data-use terms are checked.

Implemented source-specific adapters: Enka static avatar definitions, offline Enka localization snapshots, KQM TCL character-reference page index, and local Genshin-DB snapshot import. Network adapters create user-triggered, versioned drafts requiring approval and record successful checks separately, including repeat checks of already-known content. Enka localizations and Genshin-DB snapshots are staged locally and versioned by content hash; their upstream check date remains unknown unless supplied through a future verifiable adapter. No full live dataset is bundled; other registry entries are references or planned/candidate adapters.
