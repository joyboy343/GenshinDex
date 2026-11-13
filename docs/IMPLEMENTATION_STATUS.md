# Implementation status

| Milestone | Status | Implemented now | Remaining |
|---|---|---|---|
| 0. Product architecture | Complete baseline | Scope, architecture, docs, source policy, roadmap | Revisit decisions as implementation evidence arrives |
| 1. Backend platform | Adapter complete | SQLite migrations, API, account foundation, worker/SSE, launcher | Install target stack and complete full strict typing/session hardening |
| 2. Game-wide sources and knowledge | In progress | Source registry and coverage, Genshin-DB English snapshot importer/category browser, offline Enka localization import and hash-based name resolution, Enka static avatar definitions, KQM TCL reference index and user-staged page evidence extraction, cross-source matching/conflict report, version-bound identity and field-level review history, deterministic projection, immutable projection snapshots and historical comparison, full reconciliation snapshots and comparison including unmatched records and KQM references, draft approvals, append-only successful live-check history with version/hash/revision and coverage freshness visibility | No live/local external dataset supplied yet; broader KQM page coverage and recommendation-specific extraction, remaining source adapters, historical source-only snapshot comparison, semantic search; offline staged data retains unknown source-check time; extracted KQM text remains experimental and non-authoritative |
| 3. Accounts and inventory | Not started | Account profile records only | Enka/GOOD/manual adapters, owned inventory, completeness and transactional reconciliation |
| 4. Character Laboratory | Not started | — | Roster, profiles, target/simulation, optimizer |
| 5. Team Laboratory | Not started | — | Recommendations, rotations, allocation conflicts |
| 6. Damage Laboratory | Not started | — | Verified formulas, simulations, individual/team DPS |
| 7. Progression Centre | Not started | — | Materials, plans, crafting, farming, resin, reservations |
| 8. Endgame Centre | Not started | — | Abyss, Onslaught, Theater and history |
| 9. Exploration Centre | Not started | — | Licensed map, markers, routes and progress |
| 10. Wishlist and Gacha | Not started | — | Banner rules, pity, forecast, simulation |
| 11. Settings and maintenance | Not started | Basic local diagnostics only | Backups, restore, settings, notifications, updates |
| 12. Frontend infrastructure | In progress with adapter | HTML/CSS/JS shell, profile setup, jobs, knowledge search and review UI | React/Vite, Tailwind, Radix, Motion and typed query client |
| 13. Frontend product modules | Not started | — | Build module pages and integrate backend contracts |
| 14. Cross-module QA and release | Not started | Node integration suite and DB check scripts | Full acceptance/security/offline/performance/E2E and packaging |

## Current blockers and limits

- npm registry access is blocked and the package cache cannot satisfy required packages. The user has been asked for registry or offline-cache access; the runnable adapters remain in place while that is pending.
- The game data registry lists official, Enka, GOOD/Genshin Optimizer, roster-wide KQM, official map, and candidate community catalog sources with their coverage limits. It is not a claim that all character records or data adapters have already been loaded.
- Only one general mechanics entry is bundled so far. It is community-confirmed with numeric confidence unknown and is not used in calculations.
- The static Enka catalog adapter is implemented, but this environment cannot reach upstream hosts, so no live roster catalog has been downloaded or approved. Local fixture tests cover normalization only.
- Enka's documented `NameTextMapHash` to localization mapping is implemented as an offline staged import of `store/gi/locs.json`. No localization archive has been staged yet; names remain unresolved until both catalogs are approved and exact hashes match.
- The KQM adapter tracks index page existence only. It does not treat the index as a complete playable roster or as full character build guides. KQM records remain a separate source-specific catalog pending reconciliation against canonical game definitions.
- The Genshin-DB importer is tested with fixture gzip data, but no user-provided snapshot has been staged or approved. Genshin-DB records remain source-specific candidates pending cross-source review and licensing review.
- No imported player data, fabricated character roster, or assumed inventory completeness is bundled.
