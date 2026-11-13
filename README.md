# GenshinDex

GenshinDex is a local-first companion for organizing and improving a Genshin Impact account. The repository has a working Phase 1 foundation and the first slice of Phase 2: local account profiles, persistence, API/worker infrastructure, a setup screen, and a small versioned knowledge catalog. The larger product modules are planned and tracked, not yet implemented.

## Run locally

Requirements: Windows and Node.js 22.13 or later. Node.js 24 is recommended. The current bootstrap uses Node's built-in SQLite support and does not need an external database service.

```powershell
npm run start:windows
```

The launcher starts the local server, waits for its health endpoint, opens `http://localhost:3101`, and stops the server when you exit the launcher with Ctrl+C. The API binds only to `127.0.0.1`.

You can also start the API directly:

```powershell
npm start
```

Then open `http://localhost:3101` yourself. The SQLite database is created at `storage/database/genshindex.sqlite` on first run. It is local application data and is not encrypted by this Phase 1 implementation.

## What works today

- Create and list multiple local profiles with optional UID and server.
- Persist account profiles in SQLite with foreign keys enabled and versioned SQL migrations.
- Reject duplicate UID/server combinations and invalid profile input.
- Run a sample worker-thread job, observe progress through SSE, or poll its status through the API.
- Use a local account setup/status screen with no external game login.
- Search a sourced knowledge entry offline and inspect its verification state, confidence, limitations, and provenance.
- Preview knowledge dataset updates as drafts and explicitly approve versions while preserving the prior dataset and carrying forward omitted entries.
- Inspect the source registry and its coverage/rate-limit/reuse guardrails through the API.
- Browse the same source coverage and limitations in the Knowledge Library screen.
- Stage an offline Genshin-DB release for review across characters, weapons, artifacts, materials, enemies, and supported reference categories; browse approved category records locally.
- Stage Enka's processed localization file for multilingual hash-to-name resolution against approved static avatar definitions.
- Compare approved character sources by ID/name and inspect element, weapon, or rarity conflicts without automatically merging datasets.
- Generate a versioned candidate roster projection from confirmed identity links while keeping field conflicts unresolved.
- Save immutable, content-addressed projection snapshots and inspect prior versions without changing current source data.
- Compare saved projection versions for source, roster, value, and evidence changes.
- Save and compare complete source reconciliation reports, including unmatched candidates and guide-page coverage.
- Stage KQM character page HTML locally, extract section-level statements and tables, and review them as experimental evidence before approval.
- Review character-field conflicts against current evidence, retaining a version-bound audit trail for selected or deferred values.
- Check database integrity and foreign-key consistency.

The sample worker job only demonstrates background-job infrastructure. It does not calculate game damage or perform another game-specific operation.

## Development checks

```powershell
npm run check
npm test
npm run db:check
```

The current test suite uses Node's built-in test runner and covers account persistence/validation, background jobs, the served screen, host/origin/request guards, knowledge search/version approval, and offline source-data snapshot ingestion. `npm run check` performs source syntax checks. It is not a strict TypeScript type check.

## Project layout

```text
apps/
  server/       Local API, SQLite migrations, worker jobs
  web/          Initial local foundation screen
packages/
  contracts/    Shared API contract package boundary
  game-data/    Versioned game data package boundary
  calculation-core/ Pure calculation package boundary
  ui/           Shared UI package boundary
data/           Dataset and cache locations
storage/        Local database and backup locations
docs/           Architecture, API, security, and roadmap documentation
scripts/        Checks and Windows launcher
tests/          Local integration and infrastructure tests
```

## Architecture and current stack status

The target architecture is a pnpm monorepo with React, TypeScript, Vite, Tailwind CSS, Radix UI, Fastify, REST, SQLite, Drizzle ORM, Zod, TanStack Query, worker threads, and SSE. The workspace declares this intended dependency set and uses strict TypeScript compiler options.

The environment used to create the initial foundation has no pnpm installation and cannot reach the npm registry. To keep the application runnable, the current server uses Node's built-in HTTP and SQLite modules, and the first screen uses dependency-free HTML, CSS, and JavaScript. Fastify, Drizzle, React/Vite, and a full strict TypeScript build remain to be integrated when dependencies are available. See [the architecture notes](docs/ARCHITECTURE.md) for the adapter rationale and [implementation status](docs/IMPLEMENTATION_STATUS.md) for outstanding work.

## API overview

API base path: `/api/v1`.

| Endpoint | Purpose |
|---|---|
| `GET /health` | API and database health |
| `GET /api/v1/accounts` | List local profiles |
| `POST /api/v1/accounts` | Create a local profile |
| `GET /api/v1/sources` | List source scopes and data-use guardrails |
| `POST /api/v1/jobs/sample` | Start an infrastructure sample job |
| `GET /api/v1/jobs/:id` | Poll background-job status |
| `GET /api/v1/jobs/:id/events` | Stream background-job updates over SSE |
| `POST /api/v1/jobs/:id/cancel` | Request job cancellation |
| `GET /api/v1/knowledge?q=...` | Search approved local knowledge |
| `POST /api/v1/knowledge/datasets/preview` | Validate an update and save it as a draft |
| `POST /api/v1/knowledge/datasets/:id/approve` | Explicitly approve a draft dataset |

State-changing API requests require JSON and the `X-GenshinDex-Request: 1` header. The API rejects foreign Host and Origin values. This is a local application baseline, not protection from other processes on the same computer; it does not implement a full session and CSRF model.

## Data and privacy

- Profiles are stored in the local SQLite database.
- Genshin passwords, authentication cookies, and game credentials are not requested.
- There is no cloud sync or external user account system.
- One community-confirmed mechanics overview is bundled with its source and limitations; it is not used in calculations. Character, enemy, and combat parameter datasets are not bundled.
- Imports, backups, encryption, and restore workflows are not implemented yet.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database schema](docs/DATABASE_SCHEMA.md)
- [API reference](docs/API_REFERENCE.md)
- [Game data pipeline](docs/GAME_DATA_PIPELINE.md)
- [Source registry and source policy](docs/SOURCE_REGISTRY.md)
- [Character data scope and source matrix](docs/CHARACTER_DATA_SCOPE.md)
- [Calculation engine](docs/CALCULATION_ENGINE.md)
- [Security](docs/SECURITY.md)
- [Imports](docs/IMPORTS.md)
- [Backups and recovery](docs/BACKUPS_AND_RECOVERY.md)
- [Offline operation](docs/OFFLINE_OPERATION.md)
- [Design system](docs/DESIGN_SYSTEM.md)
- [Implementation roadmap](docs/IMPLEMENTATION_ROADMAP.md)
- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
- [Changelog](docs/CHANGELOG.md)
