# KOI-76 Handoff

Last updated: 2026-06-08 15:30 CDT
Branch: `main`
Base commit: see `git log --oneline -1`
Linear: `KOI-76` — Wire `recordRunningPrs` into TCX import path

## Goal

Call `recordRunningPrs` after each exercise log insert inside `tcxImportRouter.commit`, so TCX-imported running workouts produce `personal_record` rows just like manually created workouts.

## What to change

File: `packages/api/src/routers/tcx-import.ts`

1. Add import:
   ```ts
   import { recordRunningPrs } from "../lib/personal-records";
   ```

2. Inside the `db.transaction` in `commit` (around line 254–268), after the `exerciseLog` insert and before `importedExerciseIds.add(...)`, add:
   ```ts
   await recordRunningPrs(tx, {
     userId,
     exerciseId,
     workoutId,
     dateAchieved: run.startedAtDate,
     distanceMeter: run.distanceMeter,
     durationMinutes,
   });
   ```

   All three values are already computed at that point in the loop. `durationMinutes` is `Math.max(1, Math.round(run.durationSeconds / 60))` — always non-null and > 0 — so both `longest_distance` and `best_pace` will be checked on every import.

## Test file

`packages/api/src/__tests__/tcx-import.test.ts`

The existing tests mock `db.transaction` with a `mockTx`. The `mockTx` in that test file currently has `insert` and `update` but no `select`. After adding the `recordRunningPrs` call, `tx.select` will be called inside the transaction (twice per run: once for `existingForWorkout`, once for `priorBest`).

Changes needed in the test:
1. Add `select: vi.fn()` to `mockTx`
2. In `beforeEach`, add `mockTx.select.mockReturnValue(makeChain([]))` so all in-transaction selects return empty arrays (no prior PRs)
3. Add mock calls for the PR inserts in each test that exercises the `commit` path — currently tests only mock workout + exerciseLog inserts; you'll need to add a third `mockTx.insert` mock for the PR insert per run

## Acceptance criteria (from KOI-76)

- [ ] Committing a TCX import for a running activity creates a `personal_record` row if it beats prior best
- [ ] Re-committing the same TCX file is idempotent (unique constraint prevents duplicates)
- [ ] A TCX import with a shorter distance than an existing PR produces no PR row

## Current state

- KOI-73 (unique index), KOI-74 (recordPr lib), KOI-75 (wire create/update) all complete and merged to `main`
- `recordRunningPrs` is exported from `packages/api/src/lib/personal-records.ts`
- TCX commit path fully reads: `packages/api/src/routers/tcx-import.ts` lines 230–269
- The `makeChain` proxy pattern used in test mocks is identical to the one in `workouts-cardio.test.ts` — follow that file's pattern for adding `select` support

## Next steps after KOI-76

KOI-77 (fix `whoop.commit`) and KOI-78 (extract `upsertWhoopWorkout`) are parallel and both blocked only by KOI-74, which is already done. Either can start immediately after KOI-76 lands.
