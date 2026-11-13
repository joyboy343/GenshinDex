# GenshinDex implementation milestones

This roadmap groups the full product into reviewable milestones and preserves the required layer-first order: backend platform, backend domains and integrations, API/data validation, frontend infrastructure, frontend modules, cross-module integration, then release QA. Every milestone has its own tests and acceptance checks; release QA does not replace incremental testing.

## Milestone 0 — Product architecture and project controls

**Status: Complete (initial baseline)**

Scope: product boundaries, privacy constraints, source policy, monorepo shape, runtime/dependency strategy, database/API planning, design direction, changelog, and status tracking.

Acceptance: architecture and future work are documented; no unrelated workspace content is overwritten; local-first and no-credential/no-automation rules are explicit.

## Milestone 1 — Backend platform and local runtime

**Status: Implemented with a temporary runtime adapter; target dependencies blocked**

Scope: monorepo, strict TypeScript configuration, migrations, SQLite, REST conventions, loopback security baseline, workers, SSE, launcher, health/integrity checks, and the backend package boundary.

Current adapter: Node built-in HTTP, SQLite, and worker threads. Target: Fastify, Drizzle, Zod, and the intended worker/job packages. The adapter can be replaced behind the API/repository boundaries when packages are available.

Acceptance: clean startup and shutdown, loopback-only binding, migration replay, account persistence, uniform responses, persisted job progress/cancellation, SSE and polling, and passing backend contract/integration checks.

## Milestone 2 — Game-wide data sources, canonical catalog, and knowledge engine

**Status: In progress**

Scope: a source registry, adapters, canonical records, per-record provenance and completeness, dataset versioning, review/approval, history, local search, and all-character coverage reporting.

Sources must be used for their actual scope:

- **HoYoverse official information:** official descriptions, announcements, version releases, and challenge rules.
- **Enka.Network:** static ID/localization mappings and, separately, user-requested public showcase snapshots. Showcase data is not full account inventory and must not imply unlocked viewpoints.
- **GOOD and Genshin Optimizer:** player inventory interchange and schema compatibility, not a global encyclopedia or authoritative mechanic source.
- **KeqingMains character guides:** recommendations indexed per playable character and guide revision, across the roster; a missing or stale guide stays visibly missing/stale.
- **KeqingMains Theorycrafting Library:** character-specific and shared-mechanic references with page-level evidence, test date, version, confidence, and limitations.
- **Other community catalogs (including Project Amber and Genshin-DB):** candidate/cross-check inputs only until freshness, provenance, terms, and licensing are reviewed.
- **HoYoLAB Interactive Map:** reference-only until an allowed structured interface and data-use terms are established.

Acceptance: every canonical record has a source and source revision; roster coverage is computed from the selected release rather than hand-assumed; conflicts and unsupported values are visible; new data remains draft until approval; missing entries carry forward; historical versions reproduce previous results; keyword search works offline. No source is treated as universally authoritative.

Implemented milestone slices so far: registry and source-policy API; KQM TCL page-presence index; Enka static avatar definitions and offline localization import; offline Genshin-DB category snapshot import and browse API; candidate identity matching, field-level conflict report, version-bound accept/reject/defer identity history, deterministic canonical candidate projection, immutable projection snapshots, field-level source selection/defer history, and append-only successful live-check history for Enka and KQM with explicit check-unknown handling for local staged imports. The projection preserves field-level provenance and conflicts and is explicitly excluded from authoritative calculations. All staged catalogs remain source-specific candidates. Remaining Milestone 2 work includes broader KQM evidence extraction, historical source-only snapshot comparison, remaining source adapters, and semantic search. No upstream dataset is currently staged in this workspace.

## Milestone 3 — Accounts, inventory, and transactional imports

**Status: Not started**

Scope: account switching and isolation; Enka showcase adapter; GOOD v1–vN adapters supported by the verified schema; manual correction; per-category completeness; current/imported/manual values; inventory entities; conflict previews; transaction, rollback, and equipment identity rules.

Acceptance: two accounts remain isolated; showcase-only imports never mark the roster or inventory complete; imports never delete omitted records; conflicts and proposed edits are reviewable before atomic approval; the existing state can be restored.

## Milestone 4 — Character Laboratory

**Status: Not started**

Scope: full roster views, character pages, actual/target/simulation separation, multiple profiles, weapon/artifact catalogs, artifact optimizer, talent targets, comparisons, snapshots, notes, and build reports.

Acceptance: every supported character uses its own sourced definition/profile; hypothetical equipment never mutates actual inventory; physical equipment conflicts are enforced; optimizer objectives and energy tradeoffs are explained.

## Milestone 5 — Team Laboratory and rotation planning

**Status: Not started**

Scope: recommendations, owned/theorycrafting team builder, role and reaction analysis, energy, cooldowns, buffs, substitutions, team history, rotation timeline, and practice mode.

Acceptance: recommendations cite assumptions and roster/data versions; a physical item cannot be assigned to multiple actual characters; rotations can be edited and energy/buff uptime is reported; hypothetical allocation remains isolated.

## Milestone 6 — Damage Laboratory and verified simulation

**Status: Not started**

Scope: formula engine, reactions, enemy mechanics, ICD/gauge, individual contribution, combined team DPS, Monte Carlo, what-if analysis, survivability, verification lab, reproducible inputs, and versioned results.

Acceptance: reference cases pass before a mechanic is labelled verified; damage events attribute character/reaction/buff; team DPS is total team damage divided by shared elapsed time; calculations expose source, game-data, engine version, assumptions, confidence, and limitations.

## Milestone 7 — Progression Centre

**Status: Not started**

Scope: material inventory and unknown quantities, crafting graph, ascension/talent/weapon plans, farming, resin, project priorities, shared reservations, and resource allocation scenarios.

Acceptance: crafting never double-counts; unknown is not zero; reservations across projects are explainable; committed allocation requires approval; farming recommendations account for day, resin, and project priority.

## Milestone 8 — Endgame Centre

**Status: Not started**

Scope: Spiral Abyss, Stygian Onslaught, Imaginarium Theater, rules snapshots, readiness, team pairing, encounter alternatives, and performance history.

Acceptance: each mode has its own versioned readiness rules; both Abyss sides are planned together with equipment conflicts; failed attempts and historical builds remain reproducible.

## Milestone 9 — Exploration Centre

**Status: Not started**

Scope: exploration dashboard/map, licensed marker data, fog of war, manual statuses, custom notes, goals, routes, offline caching, and official-vs-manual progress distinction.

Acceptance: marker source/license is recorded; unknown, collected, and uncollected remain distinct; manual completion is never labelled official; offline map use obeys tile-provider terms.

## Milestone 10 — Wishlist and Gacha

**Status: Not started**

Scope: banners, wish history, pity/guarantees/fate points by version, target lists, budgets, income scenarios, Monte Carlo, notifications, and opportunity-cost analysis.

Acceptance: versioned banner rules drive every calculation; estimated and confirmed Primogems are separated; simulations are reproducible; no real wish action exists.

## Milestone 11 — Settings, backups, maintenance, and diagnostics

**Status: Not started**

Scope: local backups and retention, selective restore, integrity and migration checkpoints, import review, appearance, notifications, privacy, storage, update checks, and redacted diagnostics.

Acceptance: full/selective restore preserves unaffected accounts; integrity is checked before restore; diagnostics redact UIDs and personal notes; app updates require user approval.

## Milestone 12 — Frontend infrastructure and design system

**Status: In progress with a dependency-free screen**

Scope: React/TypeScript/Vite, Tailwind, Radix primitives, Motion, TanStack Query, routing, accessible shell, top navigation/mega-menus, original celestial visual system, responsive layouts, reduced motion, and loading/error/empty states.

Current adapter: local HTML/CSS/JS. It already supports profile setup, background-job status, offline knowledge search, source inspection, and draft review/approval. React/Vite conversion waits on package access.

Acceptance: keyboard and screen-reader usable; readable with custom backgrounds; no primary permanent sidebar; frontend uses only typed, versioned API contracts.

## Milestone 13 — Frontend product modules

**Status: Not started**

Scope: connect all 11 product modules to their backend contracts, implement account-aware navigation, filters, comparisons, dashboards, editable plans, maps, reports, import approvals, and onboarding.

Acceptance: all visible controls perform a documented operation; every page has loading, empty, error, and success states; selected account/project context is preserved across navigation.

## Milestone 14 — Cross-module integration and release QA

**Status: Not started**

Scope: command centre, activity log, universal comparisons, exports, saved dashboard layouts, full account-isolation workflows, offline checks, security/performance regression, and local packaging.

Acceptance: the specification's 10 critical data-integrity scenarios pass; the launcher starts/stops cleanly; backup/restore, offline behavior, migrations, and calculated-result reproducibility pass; performance budgets are benchmarked; known limitations ship in diagnostics/docs.

## Current next work

Milestone 2 now has fixed-source Enka static avatar definitions and KQM TCL reference-index import/review flows, deterministic read-only canonical candidate projections, immutable content-addressed projection snapshots, version-bound field-level review, accepted-projection history comparison, full reconciliation report snapshots/comparison including unmatched candidates and KQM pages, and offline user-staged KQM page evidence extraction. Next: expand KQM page coverage and recommendation-specific evidence, reconcile page sections/slugs to canonical definitions, and add source freshness/history comparison across raw source snapshots. The current machine cannot reach external hosts, so live fetch/coverage approval is pending network access. After the static data adapters are exercised against upstream data, proceed to the GOOD and Enka showcase import adapters in Milestone 3. The dependency-free account/knowledge screen remains the integration surface while package-registry access is pending.
