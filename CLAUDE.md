# CLAUDE.md

Repo-level context for coding agents. Keep facts here current with the code.

## What this is

A personal fitness / life tracker: log workouts, import runs (TCX), sync Whoop
recovery/sleep, and surface analytics (volume, personal records, progressive
overload). End-to-end type-safe via tRPC; React web client, Hono server.

## Layout

Turborepo monorepo, pnpm workspaces (`apps/*`, `packages/*`). Package name prefix: `@life-tracker/*`.

- `apps/web` — React + TanStack Router + Tailwind + shadcn/ui frontend. Dev port **3001**.
- `apps/server` — Hono server; mounts tRPC, Better-Auth, Whoop OAuth, internal routes. Dev/prod port **3000**.
- `packages/api` — tRPC routers (`src/routers/`) + pure business logic (`src/lib/`).
- `packages/auth` — Better-Auth configuration.
- `packages/db` — Drizzle schema (`src/schema/`), migrations (`src/migrations/`), seed (`src/seed.ts`), `docker-compose.yml` for local Postgres.
- `packages/env` — zod-validated env (`src/server.ts`). Single source of truth for required vars.
- `packages/shared` — types/helpers shared across packages.
- `packages/config` — shared tsconfig / tooling config.

## Commands

Run from repo root (Turborepo fans out to packages).

- `pnpm dev` — all apps in dev. `pnpm dev:web` / `pnpm dev:server` for one.
- `pnpm build` — build all (`apps/server` bundles via tsdown; see `apps/server/tsdown.config.ts`).
- `pnpm check-types` — `tsc` across the workspace. Run regularly.
- `pnpm test` — Vitest across packages (most tests live in `packages/api`).
- `pnpm turbo "//#lint"` — oxlint (root task, not per-package). `pnpm lint:fix` to autofix.
- `pnpm db:start` — local Postgres via Docker. `db:stop` / `db:down` to halt/remove.
- `pnpm db:push` — push schema to DB (dev). `db:generate` + `db:migrate` for versioned migrations. `db:seed` seeds reference data. `db:seed:finance` seeds the dev login and finance fixtures (dev only, idempotent). `db:studio` opens Drizzle Studio.

## Verifying UI changes

Before you write QA steps for the user, run the app and check the change yourself. The `run` skill (`.claude/skills/run/SKILL.md`) starts the stack with logs in `logs/`, logs in as the seeded dev user (`dev@palestra.local` / `palestra-dev-password`) and covers the finance fixture cases.

## Conventions

- **tRPC routers** live in `packages/api/src/routers/`, composed in `routers/index.ts`. Auth gates (`protectedProcedure`, `adminProcedure`) are defined in `packages/api/src/index.ts` — `adminProcedure` checks `ADMIN_EMAILS`.
- **Pure lib**: keep business logic in `packages/api/src/lib/` as pure functions (no HTTP/DB coupling where possible) so it is unit-testable. Tests sit next to the code as `*.test.ts`.
- **Drizzle schema**: one table group per file in `packages/db/src/schema/`, re-exported from `schema/index.ts`. Enums in `schema/enums.ts`.
- **Migrations**: schema changes go through `db:generate` (writes SQL to `src/migrations/`); never hand-edit applied migrations.
- **Env**: add new vars to `packages/env/src/server.ts` AND document them in `apps/server/.env.example`.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`), often with a `(scope)` and trailing Linear id, e.g. `fix(volume): ... (KOI-82)`.

## Critical paths

- **Whoop webhook queue**: inbound webhooks are persisted then drained, not processed inline. Drain on startup via `whoop-webhook-drain.ts` (called from `apps/server/src/index.ts`); handler logic in `whoop-webhook.ts`. Don't assume synchronous processing.
- **Fire-and-forget recalcs**: after writes, volume/PR/overload recalcs are kicked off un-awaited with `.catch(...)` logging (see `muscle-group-volume-db.ts`, `progressive-overload-db.ts`). They must never throw into the request path. Dedup workout dates by ISO week (`date-utils.ts` `isoWeekKey`) before recalculating.
- **Personal records**: derived/recomputed from logs (`personal-records.ts`, schema `personal-record.ts`) — treat the PR table as recomputable, not a hand-edited source of truth.
- **Token encryption**: Whoop OAuth tokens are encrypted at rest via `token-encryption.ts` using `TOKEN_ENCRYPTION_KEY` (64 hex chars). Never log or store raw tokens.

## Testing

Vitest. Co-located `*.test.ts` in `packages/api/src/lib/` (and `src/__tests__/` for cross-cutting suites like auth). Setup in `packages/api/.../setup.ts` seeds test env (e.g. `ADMIN_EMAILS`). Prefer testing pure lib functions over routers; run single files while iterating, full `pnpm test` before done.

## Deploy

Server deploys to Fly.io (`fly.toml`, app `palestra`, region `dfw`, internal port 3000) from the root `Dockerfile`. Release runs `scripts/fly-release.sh` (DB migration step). `NODE_ENV=production` and `PORT=3000` set in `fly.toml`.

## Agent skills

### Issue tracker

Issues are tracked in **Linear** (via the Claude Linear MCP plugin), matching the repo's `KOI-xx` ticket convention. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles using default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context monorepo layout (`GLOSSARY-MAP.md` → per-package `GLOSSARY.md`). See `docs/agents/domain.md`.
