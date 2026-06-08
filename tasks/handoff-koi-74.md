# KOI-74 Handoff

Last updated: 2026-06-08 15:18 CDT
Branch: `main`
Base commit observed: `c3c58dbab4237674c8a8b4b3f7c26412ba13a6f9`
Linear: `KOI-74` is assigned to Anthony and moved to `Done`.

## Goal

Create `packages/api/src/lib/personal-records.ts` as the shared personal record detection and persistence library.

Required exports:

- `recordPr(tx, args): Promise<boolean>`
- `recordRunningPrs(tx, args): Promise<boolean[]>` or equivalent useful result
- `recordStrengthPrs(tx, args): Promise<boolean[]>` or equivalent useful result

Core behavior from Linear:

- Fetch existing PR row for `(userId, exerciseId, recordType, workoutId)`.
- Fetch prior best for `(userId, exerciseId, recordType)` excluding this `workoutId`.
- Insert or update when candidate beats prior best.
- Delete an existing same-workout PR when an edited candidate no longer beats prior best.
- No-op when candidate is absent or does not beat prior best and no same-workout PR exists.
- `best_pace` is lower-is-better. All other record types are higher-is-better.

Candidate rules:

- `longest_distance`: `distanceMeter`; skip null or zero.
- `best_pace`: `(durationMinutes * 60) / (distanceMeter / 1000)`; skip when either input is null or zero.
- `max_weight`: max non-null set weight; skip bodyweight/all-null weighted sets.
- `max_reps`: max non-null reps; still record bodyweight reps.
- `max_volume`: sum `weight * reps` for sets with non-null weight and reps; skip no weighted sets.

Acceptance cases to test:

- Insert first PR.
- Append second PR for a different workout.
- No-op for non-record candidate with no same-workout row.
- Delete same-workout row when an edited workout drops below prior best.
- Update same-workout row when an edited workout becomes a PR.
- Lower `best_pace` wins.
- Bodyweight sets skip `max_weight` and `max_volume`, but still record `max_reps`.

## Current State

- KOI-73 is complete and Linear `Done`; the unique DB index exists and was verified locally in the previous task.
- Current `git status --short` before KOI-74 edits showed only unrelated untracked `tasks/plans/`.
- KOI-74 implementation is complete locally.
- Added `packages/api/src/lib/personal-records.ts`.
- Added `packages/api/src/lib/personal-records.test.ts`.
- Updated `tasks/todo.md`.

## Implementation Notes

- `recordPr` checks the same-workout PR row first, then checks prior best excluding the current workout.
- `best_pace` uses lower-is-better comparison; every other `record_type` uses higher-is-better.
- Null or undefined candidates do not create records and will delete an existing same-workout PR row, which keeps edits from leaving stale PRs.
- `recordRunningPrs` records `longest_distance` and derived `best_pace` in seconds/km.
- `recordStrengthPrs` records `max_weight`, `max_reps`, and `max_volume`; bodyweight-only sets only record `max_reps`.
- Route wiring is intentionally not done here; KOI-75 owns replacing the bespoke logic in `routers/workouts.ts`.

## Verification Completed

- `pnpm --filter @src/api test -- src/lib/personal-records.test.ts`
  - Vitest ran the broader API suite in this workspace invocation.
  - Result: 24 files passed, 373 tests passed, including 9 new KOI-74 tests.
- `pnpm check-types`
  - Result: passed.

## Next Steps For KOI-75

1. Inspect:
   - `packages/db/src/schema/personal-record.ts`
   - `packages/db/src/schema/enums.ts`
   - `packages/api/src/routers/workouts.ts`
   - existing API lib tests under `packages/api/src/**/*.test.ts`
2. Import `recordRunningPrs` and `recordStrengthPrs` from `packages/api/src/lib/personal-records.ts`.
3. Delete old `RunningPrRecordType`, `isBetterRunningPr`, `runningPrByKey`, and `maybeInsertRunningPr` logic from `routers/workouts.ts`.
4. Wire create/update paths to use the new shared lib.
5. Update the existing cardio tests because `best_pace` will now be inserted when duration/distance are available.
