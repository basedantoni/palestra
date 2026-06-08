# KOI-75 Wire recordPr into workouts.create and workouts.update

- [x] Read workouts.ts, personal-records.ts, and both affected test files
- [x] Remove RunningPrRecordType, isBetterRunningPr, runningPrByKey, maybeInsertRunningPr, existing-PRs pre-fetch
- [x] Wire recordRunningPrs + recordStrengthPrs into workouts.create
- [x] Add exercise pre-fetch + wire recordRunningPrs + recordStrengthPrs into workouts.update
- [x] Update workouts-cardio.test.ts and workouts-distance-normalization.test.ts
- [x] Run full test suite and type check

## KOI-75 Review

- Deleted old PR logic: `RunningPrRecordType`, `isBetterRunningPr`, `runningPrByKey` Map, existing-PRs pre-fetch block, `maybeInsertRunningPr` closure.
- Removed `personalRecord` from `workouts.ts` imports (no longer directly accessed).
- `workouts.create`: replaced bespoke closure with `recordRunningPrs` (cardio exercises) and `recordStrengthPrs` (exercises with sets) per log.
- `workouts.update`: added exercise category pre-fetch before transaction; capture `createdLog` return value; call same PR wrappers after each log re-insert.
- Both running exercise tests updated: added `select: vi.fn()` + `mockTx.select.mockReturnValue(makeChain([]))` to handle `recordPr`'s in-transaction selects; removed stale second `mockDb.select` for existing-PRs pre-fetch.
- 373/373 tests pass. `pnpm check-types` clean.

# KOI-74 Core Personal Record Library

- [x] Fetch KOI-74 from Linear and move it to In Progress
- [x] Inspect current personal record schema, query usage, and workout PR logic
- [x] Add `packages/api/src/lib/personal-records.ts`
- [x] Implement `recordPr`
- [x] Implement `recordRunningPrs`
- [x] Implement `recordStrengthPrs`
- [x] Add unit tests for KOI-74 acceptance criteria
- [x] Run focused tests and type checks
- [x] Update handoff and Linear

## KOI-74 Review

- Added `packages/api/src/lib/personal-records.ts` with `recordPr`, `recordRunningPrs`, and `recordStrengthPrs`.
- `recordPr` supports append-only records, same-workout update/delete for edit-aware behavior, strict prior-best comparisons, and lower-is-better `best_pace`.
- `recordRunningPrs` records `longest_distance` and derived `best_pace` in seconds/km.
- `recordStrengthPrs` records `max_weight`, `max_reps`, and `max_volume`; bodyweight-only sets only record `max_reps`.
- Added `packages/api/src/lib/personal-records.test.ts` covering all KOI-74 acceptance criteria plus weighted wrapper behavior.
- Verification passed: `pnpm --filter @src/api test -- src/lib/personal-records.test.ts` and `pnpm check-types`.
- Handoff updated in `tasks/handoff-koi-74.md`; route wiring remains for KOI-75.

# KOI-73 Personal Record Unique Index

- [x] Fetch KOI-73 from Linear and move it to In Progress
- [x] Inspect DB schema and migration conventions
- [x] Add the four-column unique index to `personal_record`
- [x] Repair existing Drizzle metadata so generation can run
- [x] Generate migration `0017_personal_record_unique.sql`
- [x] Apply the migration locally
- [x] Verify the unique index exists and rejects duplicate rows
- [x] Run focused automated verification
- [x] Document KOI-73 review results

## KOI-73 Review

- Added `personal_record_user_exercise_type_workout_uq` to the Drizzle schema and generated `0017_personal_record_unique.sql`.
- Repaired existing Drizzle metadata needed for generation: fixed the `0009_snapshot.json` self-parent and restored missing `0015`/`0016` snapshots for already-registered Whoop migrations.
- Applied migrations locally with `pnpm --filter @src/db db:migrate`.
- Verified `pg_indexes` returns `personal_record_user_exercise_type_workout_uq`.
- Verified a duplicate `(user_id, exercise_id, record_type, workout_id)` insert fails with `23505:personal_record_user_exercise_type_workout_uq` inside a rollback-only transaction.
- Verification passed: `pnpm --filter @src/db exec drizzle-kit check --config drizzle.config.ts`, `pnpm check-types`, and `pnpm --filter @src/db db:generate` reports no pending schema changes.

# Nike TCX Import

- [x] Phase 1: Add XML parser dependency and dry-run parser script
  - [x] Add `fast-xml-parser` to `@src/db`
  - [x] Add `fast-xml-parser` at the repo root for top-level script resolution
  - [x] Add root `import:nike-tcx` script and root `tsx` devDependency
  - [x] Create `scripts/import-nike-tcx.ts`
  - [x] Run `pnpm install`
  - [x] Run TypeScript checks
  - [x] Run dry-run parser against Nike TCX directory
- [ ] Phase 2: DB writes, dedup, and import
  - [x] Load seeded Short Run and Long Run exercise rows
  - [x] Build Nike Run Club dedup index from existing workouts
  - [x] Insert workout and exercise log rows transactionally
  - [x] Keep dry-run read-only while exercising DB lookup and dedup
  - [x] Resolve TCX duplicate-count mismatch before real import
  - [x] Run real import for `anthony <ant@gmail.com>`
  - [x] Verify immediate rerun is a no-op
  - [x] Verify imported row counts and HR coverage
  - [ ] Manually verify imported runs in the web app
- [x] Fix `/workouts` calendar month navigation freeze
  - [x] Identify maximum-update-depth loop in selected date synchronization
  - [x] Guard fallback date updates by local date key
  - [x] Run type checks and web build
- [x] Fix Fly release migration/seed failure
  - [x] Identify missing production `exercise.cardio_subtype` column after release migrations
  - [x] Add forward-only repair migration for Whoop run-linking schema
  - [x] Run type checks
  - [x] Run migration verification
- [x] Reduce Nike TCX importer memory usage for Fly
  - [x] Replace full XML object parsing with targeted TCX tag scanning
  - [x] Verify parser still reads all Nike TCX files
  - [x] Run type checks
- [x] Generic TCX Web Importer
  - [x] Phase 1: Shared TCX parsing core
    - [x] Add reusable TCX parser and fingerprint helper
    - [x] Export parser from API lib
    - [x] Add TCX parser tests
    - [x] Run parser tests and type checks
    - [x] Manual parser spot-check confirmed by user
  - [x] Phase 2: TCX import API
    - [x] Add `tcxImport.preview` and `tcxImport.commit`
    - [x] Register router on `appRouter`
    - [x] Add preview/commit tests
    - [x] Run API tests and type checks
    - [x] Manual API preview/commit confirmed by user
  - [x] Phase 3: Web TCX import route
    - [x] Add `/import/tcx` route
    - [x] Add TCX Folder card on `/import`
    - [x] Regenerate route tree
    - [x] Run web type checks and build
    - [x] Manual browser verification confirmed by user
  - [x] Phase 4: CLI alignment and cleanup
    - [x] Reuse shared TCX parser and fingerprint helper from the Nike CLI
    - [x] Remove unused `fast-xml-parser` dependency
    - [x] Document production import path
    - [x] Run type checks, web build, API tests, and CLI dry-run
- [x] Fix production analytics schema drift
  - [x] Identify `analytics.weeklyRunningVolume` selecting missing `exercise_log` metric columns
  - [x] Add idempotent repair migration for `exercise_log` metrics and distance normalization
  - [x] Run migration checks and type checks

## Whoop Webhook Integration — Phase 1

- [x] DB schema migration — add columns to `whoop_connection` and new `whoop_webhook_event` table
  - [x] `whoopUserId`, `webhookSubscriptionId`, `webhookSecret`, `webhookLastReceivedAt`, `autoImportEnabled`, `notifyOnAutoImport` added to `whoop_connection`
  - [x] `whoop_webhook_event` table created with PK, FK, indexes
  - [x] Migration generated and applied (`0013_chilly_robbie_robertson.sql`)
- [x] Write tests first (TDD — red phase confirmed)
  - [x] `packages/api/src/__tests__/whoop-webhook.test.ts` created
  - [x] Tests for: valid signature, invalid signature, unknown user, duplicate event, webhookLastReceivedAt advancement, missing header
- [x] Implement `packages/api/src/lib/whoop-webhook.ts`
  - [x] Raw body buffering before JSON parse
  - [x] Connection lookup by whoopUserId
  - [x] HMAC-SHA256 verification using decrypted webhook secret
  - [x] Insert `whoop_webhook_event` with `onConflictDoNothing`
  - [x] Update `webhookLastReceivedAt`
  - [x] `setImmediate` stub processor (flips status to `processed`, logs)
- [x] Mount webhook endpoint at `POST /api/whoop/webhook`
- [x] All 281 tests pass (17 test files)
- [x] `pnpm check-types` passes (server + web)
- [ ] Manual verification: correctly-signed synthetic payload via curl returns 200

## Review

- Phase 1 automated verification passed.
- `pnpm install --no-frozen-lockfile` completed and updated dependencies.
- TypeScript passed with `pnpm check-types`.
- Dry run parsed `126/126` TCX files with `errors: 0`.
- Sample rows showed dates from 2022 and 2025, distances from 3.24km to 6.00km, durations from 21.2min to 41.2min, and HR where available.
- Bare `tsx` is not on PATH in this shell, so verification uses `pnpm exec tsx`.
- Top-level scripts do not resolve `packages/db` devDependencies under pnpm isolation, so the XML parser is also declared at the repo root.
- User verification from `scripts/` showed `pnpm exec tsx` was unavailable because root did not declare `tsx`; root now owns the runner via `pnpm import:nike-tcx`.
- Phase 2 type checks pass.
- DB-backed dry-run for a throwaway user parsed all 126 files but reports `imported=125 skipped_duplicate=1 skipped_error=0`.
- Duplicate pair: `0bed5eea-8609-42c7-bad5-d79b7a251e3f.tcx` and `dc541d18-f9cd-4ce7-94fb-9752d700ab41.tcx` share `2022-10-29T19:05:05.526Z`, `14920.372m`, `6000.572s`, avg HR `147`, max HR `165`; the first has calories `1146`, the second has calories `0`.
- Real import for `YcKMG9bVumEcHuNwMizZ1VourXa0kiBB` inserted `125` unique Nike runs and skipped the duplicate file.
- Immediate rerun returned `imported=0 skipped_duplicate=126 skipped_error=0`.
- DB verification: `125` Nike workouts, `34` rows with heart rate, `104` Short Run rows, `21` Long Run rows, distance range `54.77m` to `42313.22m`.
- Fixed `/workouts` calendar freeze by preventing the selected-date effect from setting a new `Date` object when the selected local-day key is already the intended fallback.
- Verification passed: `pnpm check-types`, `pnpm -F web build`.
- Fly deploy failed during `release_command` after migrations because seed inserted `exercise.cardio_subtype`, but production still lacked that column.
- Added `0011_repair_whoop_run_linking` as an idempotent repair migration for `cardio_subtype`, `hr_zone_durations`, and the Whoop activity unique index.
- Verification passed: `pnpm check-types`, `pnpm -F @src/db exec drizzle-kit check --config drizzle.config.ts`, `pnpm -F @src/db db:migrate`, `pnpm -F @src/db db:seed`.
- Reduced importer memory pressure by avoiding full XML tree construction for TCX files; dry-run still parsed `126/126` files with `errors: 0` and rerun reported `imported=0 skipped_duplicate=126 skipped_error=0`.
- Generic TCX importer Phase 1 added `packages/api/src/lib/tcx-import.ts` and `packages/api/src/lib/tcx-import.test.ts`.
- Verification passed: `pnpm -F @src/api test -- tcx-import`, `pnpm check-types`.
- Real Nike TCX parser spot check for `0296d2ed-62ad-4e13-abbe-1d751c2cec2c.tcx`: `2022-09-21T12:20:52.921Z`, `3999.56m`, `1810s`, calories `290`, avg HR `142`, max HR `154`.
- Generic TCX importer Phase 2 added `packages/api/src/routers/tcx-import.ts`, registered `tcxImport`, and added `packages/api/src/__tests__/tcx-import.test.ts`.
- Verification passed: `pnpm -F @src/api test -- tcx-import`, `pnpm check-types`.
- Manual API verification confirmed healthy.
- Generic TCX importer Phase 3 added `/import/tcx`, linked it from `/import`, and regenerated the TanStack route tree.
- Verification passed: `pnpm -F web check-types`, `pnpm -F web build`, `pnpm check-types`.
- Local route smoke check passed: `http://localhost:3002/import/tcx` returns `200 OK`.
- Manual browser verification confirmed by user.
- Generic TCX importer Phase 4 updated `scripts/import-nike-tcx.ts` to reuse the shared parser/fingerprint module and removed `fast-xml-parser` from manifests and lockfile.
- Production TCX import path is now the web UI: deploy, open `/import/tcx`, select the TCX folder, review, and commit.
- Verification passed: `pnpm -F @src/api test -- tcx-import`, `pnpm -F web build`, `pnpm check-types`, `pnpm import:nike-tcx -- --user-id freshbeef --dry-run`.
- Production `analytics.weeklyRunningVolume` failed because deployed code selects `exercise_log.distance_meter`, `duration_seconds`, `rounds`, `work_duration_seconds`, and `rest_duration_seconds` but the Fly database can be missing older baseline columns.
- Added `0012_repair_exercise_log_metrics` to idempotently add missing `exercise_log` metric columns, preserve old `distance` data by renaming/converting to `distance_meter`, drop old `pace`, and ensure `exercise_set.duration_seconds` exists.
- Verification passed: `pnpm -F @src/db exec drizzle-kit check --config drizzle.config.ts`, `pnpm check-types`, `pnpm -F @src/db db:migrate`, `pnpm -F @src/api test -- analytics`.
