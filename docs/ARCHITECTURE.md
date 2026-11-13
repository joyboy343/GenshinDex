# Architecture

## Initial boundaries

GenshinDex is a loopback-only local web application. `apps/server` owns SQLite, migrations, account-scoped persistence, REST routes, job coordination and SSE. `apps/web` is the browser application. `packages/contracts` is the API boundary; `packages/game-data` owns versioned canonical datasets; `packages/calculation-core` owns pure deterministic mechanics; and `packages/ui` owns reusable visual primitives.

The database is one SQLite file with foreign keys enabled. Global game definitions do not reference accounts. User-owned records carry `account_id`; data access must require an account context and use composite constraints where relationships cross account-owned tables. Import application, backup restore and inventory/equipment changes are transactional. Hypothetical state is stored separately from actual inventory.

Long-running calculations execute in worker threads. Workers receive serializable inputs and return results; only the main process writes to SQLite. Job state is persisted, progress can be watched over SSE, and clients can poll as a fallback.

## Phase 1 runtime constraint

The workspace was empty, Node.js 24.18.0 and npm 11.16.0 are installed, and pnpm is not installed. Corepack cannot reach `registry.npmjs.org`; Fastify, Drizzle, TypeScript and the frontend toolchain are not present in the local package cache. To keep Phase 1 runnable without network access, the initial runtime uses Node's built-in HTTP server, `node:sqlite`, native TypeScript type stripping and worker threads. This is a documented bootstrap adapter, not a claim that Fastify or Drizzle is implemented. The package manifest records the intended stack. Once dependencies can be installed, replace the HTTP and SQL adapter behind the same API/repository boundaries and add a React/Vite application.

## Decisions

- Node.js 24 LTS-compatible runtime; explicit minimum Node 22.13 for built-in SQLite.
- SQLite schema changes are ordered SQL migrations recorded in `schema_migrations`.
- Bind explicitly to `127.0.0.1`; reject foreign Host and Origin headers and require a custom request header for mutations.
- Use versioned `/api/v1` endpoints and a uniform `{ data }` / `{ error }` envelope.
- Keep no sample account or fabricated game data in the authoritative database.

See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md), [API_REFERENCE.md](API_REFERENCE.md), and [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).
