# Workout Codebase Cleanup Implementation Plan

_Updated after design review — significant changes to Phase 1, Phase 2, new Backfill phase, and analytics restructure._

## Overview

Eight workout-creation paths create rows in the `workout` table, each with its own bespoke insert logic. Only `workouts.create` tracks personal records — and only for `longest_distance`. Whoop's manual bulk import sets `exerciseId = null`, making those workouts invisible to cardio analytics. Webhook and backfill duplicate ~130 lines verbatim. Analytics use three different "what is a run?" filters. `volumeOverTime` is blind to every imported workout.

This plan fixes all of these in seven phases (plus a backfill), each independently shippable.

---

## Resolved Design Decisions

These were settled during design review and are non-negotiable in implementation:

| Decision | Resolution |
|---|---|
| PR data model | Append-only log — INSERT new row each time a PR is broken, never UPDATE rows |
| Unique constraint | `(userId, exerciseId, recordType, workoutId)` — one PR row per workout per type |
| Existing duplicates | None — confirmed via SQL. No dedup migration needed |
| Edit → PR behavior | On `workouts.update`: UPDATE existing PR row if still a PR; DELETE if edited below prior best |
| PR types in scope | All 5: `longest_distance`, `best_pace`, `max_weight`, `max_reps`, `max_volume` |
| `max_reps` definition | Max reps in any single set, any weight |
| `best_pace` unit | Seconds per km = `(durationMinutes * 60) / (distanceMeter / 1000)`. Lower is better |
| Bodyweight exercises | Skip `max_weight` and `max_volume`. Include `max_reps` |
| Duration for runs | Required on manual run logs. UI field already exists — enforce at zod schema |
| Multiple logs same exercise | Aggregate across all logs for same exercise in one workout, one `recordPr` call per type |
| PR function shape | Single generic `recordPr(tx, args)`. Direction derived from `recordType` internally |
| UI display | Full progression timeline, `dateAchieved ASC` (oldest → newest) |
| Backfill | Admin tRPC endpoint, oldest-first per user, same `recordPr` function |

---

## Current State

**Eight workout-creation paths:**

| Path | File | Sets PRs? | Sets `exerciseId`? | Sets `totalVolume`? |
|---|---|---|---|---|
| `workouts.create` | `routers/workouts.ts:396-423` | Yes — `longest_distance` only | Yes | Yes |
| `workouts.update` | `routers/workouts.ts:447-494` | No | Yes | Pass-through |
| `tcxImport.commit` | `routers/tcx-import.ts:185-302` | No | Yes | No |
| `whoop.commit` (manual bulk) | `routers/whoop.ts:417-631` | No | **No (bug)** | No |
| `workoutProcessor` (webhook) | `lib/whoop-webhook.ts:149-361` | No | Yes | No |
| `triggerBackfill` | `lib/whoop-backfill.ts:103-365` | No | Yes | No |
| `import.commit` (markdown) | `routers/import.ts:111-381` | No | Yes | Yes |

**Analytics filter inconsistency:**
- `weeklyRunningVolume`, `runningPaceTrend`: `eq(exercise.category, "cardio")` — excludes null-exerciseId logs
- `runningHrTrend`, `whoopPaceTrend`, `weeklyRunDistance`: `isNotNull(workout.whoopActivityId)` — excludes TCX + manual runs
- `volumeOverTime`: reads `workout.totalVolume` — null for all import paths except markdown

---

## Desired End State

1. All 5 PR types tracked from every path that has the required data
2. `personalRecord` unique on `(userId, exerciseId, recordType, workoutId)` — enforced at DB level
3. `whoop.commit` produces workouts identical in schema to webhook/backfill imports
4. Webhook + backfill share a single `upsertWhoopWorkout` — one change propagates to both
5. All analytics "is this a run?" queries use the same join
6. `volumeOverTime` accurate for every workout source
7. (Stretch) Single `createWorkoutWithLogs` helper prevents future divergence

---

## Phase 1: DB Schema — Unique Index on `personal_record`

### What Changes

Add unique index on `(userId, exerciseId, recordType, workoutId)`. This is the idempotency guarantee that makes the append-only log safe — the same workout can't insert two PR rows for the same type.

**Why 4 columns, not 3:** The append-only model has multiple rows per `(userId, exerciseId, recordType)` by design — one per PR break. The `workoutId` column scopes uniqueness to a single workout.

### Changes Required

#### 1. Schema — `packages/db/src/schema/personal-record.ts`

Add a fourth index entry:

```ts
export const personalRecord = pgTable(
  "personal_record",
  {
    // … existing columns unchanged
  },
  (table) => [
    index("personal_record_userId_idx").on(table.userId),
    index("personal_record_exerciseId_idx").on(table.exerciseId),
    uniqueIndex("personal_record_user_exercise_type_workout_uq").on(
      table.userId,
      table.exerciseId,
      table.recordType,
      table.workoutId,
    ),
  ],
);
```

#### 2. Generate migration

```bash
pnpm --filter @src/db db:generate
```

Produces `0017_personal_record_unique.sql`. **No dedup DELETE needed** — confirmed zero existing duplicates.

```sql
CREATE UNIQUE INDEX "personal_record_user_exercise_type_workout_uq"
  ON "personal_record" ("user_id", "exercise_id", "record_type", "workout_id");
```

#### 3. Verify journal

Check `packages/db/src/migrations/meta/_journal.json` includes the new entry (see commit `b12ab5e` for precedent).

### Success Criteria

- [ ] `pnpm --filter @src/db typecheck`
- [ ] `pnpm --filter @src/db db:migrate` on fresh DB
- [ ] `pnpm -w test`
- [ ] `\d personal_record` in psql shows `personal_record_user_exercise_type_workout_uq` as UNIQUE

---

## Phase 2: `recordPr` — 5 PR Types Across All Paths

### What Changes

Extract PR detection from the `workouts.create` closure into a shared, generic `recordPr` function. Expand from 1 PR type (`longest_distance`) to all 5. Wire into every path that has the data.

### PR Types Matrix

| Type | Candidate Computation | Direction | Skip When |
|---|---|---|---|
| `longest_distance` | `log.distanceMeter` | higher | distanceMeter null/zero |
| `best_pace` | `(log.durationMinutes * 60) / (log.distanceMeter / 1000)` | **lower** | either field null/zero |
| `max_weight` | `MAX(set.weight)` across all sets for exercise | higher | all sets have null weight (bodyweight) |
| `max_reps` | `MAX(set.reps)` across all sets for exercise | higher | all sets have null reps |
| `max_volume` | `SUM(set.weight * set.reps)` for non-null weight sets | higher | no sets have non-null weight |

**Aggregation rule:** When a workout has multiple logs for the same exercise (supersets, circuits), aggregate candidates across all logs before calling `recordPr`. One call per `(exercise, recordType)` per workout.

### Path Coverage

| Path | Running PRs | Strength PRs |
|---|---|---|
| `workouts.create` | `longest_distance` + `best_pace` | `max_weight`, `max_reps`, `max_volume` |
| `workouts.update` | `longest_distance` + `best_pace` | `max_weight`, `max_reps`, `max_volume` |
| `tcxImport.commit` | `longest_distance` + `best_pace` | — (cardio only) |
| `whoop.commit` (post Phase 3) | `longest_distance` + `best_pace` | — (cardio only) |
| `workoutProcessor` (webhook) | `longest_distance` + `best_pace` | — (cardio only) |
| `triggerBackfill` | `longest_distance` + `best_pace` | — (cardio only) |
| `import.commit` (markdown) | TODO (no `distanceMeter` exposed by parser) | `max_weight`, `max_reps`, `max_volume` |

### Changes Required

#### 1. New lib: `packages/api/src/lib/personal-records.ts`

```ts
import { and, eq, max, ne, sql } from "drizzle-orm";
import { db } from "@src/db";
import { exercise, personalRecord } from "@src/db/schema/index";

export type RecordType =
  | "longest_distance"
  | "best_pace"
  | "max_weight"
  | "max_reps"
  | "max_volume";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function higherIsBetter(recordType: RecordType): boolean {
  return recordType !== "best_pace";
}

function beats(candidate: number, existing: number, recordType: RecordType): boolean {
  return higherIsBetter(recordType)
    ? candidate > existing
    : candidate < existing;
}

/**
 * Appends a new PR row when candidate beats the current best for
 * (userId, exerciseId, recordType). Handles all three cases for
 * workouts.update: UPDATE existing row, DELETE if no longer a PR,
 * or INSERT if new PR.
 *
 * Idempotent via unique index on (userId, exerciseId, recordType, workoutId).
 */
export async function recordPr(
  tx: Tx,
  args: {
    userId: string;
    exerciseId: string;
    recordType: RecordType;
    candidate: number | null | undefined;
    workoutId: string;
    dateAchieved: Date;
  },
): Promise<boolean> {
  const { userId, exerciseId, recordType, candidate, workoutId, dateAchieved } = args;

  if (candidate == null || candidate <= 0) return false;

  // Existing PR row for this specific workout (may or may not exist)
  const [existingForWorkout] = await tx
    .select({ id: personalRecord.id, value: personalRecord.value })
    .from(personalRecord)
    .where(
      and(
        eq(personalRecord.userId, userId),
        eq(personalRecord.exerciseId, exerciseId),
        eq(personalRecord.recordType, recordType),
        eq(personalRecord.workoutId, workoutId),
      ),
    )
    .limit(1);

  // Best PR excluding this workout — the "prior best"
  const [priorBestRow] = await tx
    .select({ value: max(personalRecord.value).as("value") })
    .from(personalRecord)
    .where(
      and(
        eq(personalRecord.userId, userId),
        eq(personalRecord.exerciseId, exerciseId),
        eq(personalRecord.recordType, recordType),
        ne(personalRecord.workoutId, workoutId),
      ),
    );

  const priorBest = priorBestRow?.value ?? null;

  const isNewPr = priorBest == null || beats(candidate, priorBest, recordType);

  if (isNewPr) {
    if (existingForWorkout) {
      await tx
        .update(personalRecord)
        .set({ value: candidate, dateAchieved, previousRecordValue: priorBest })
        .where(eq(personalRecord.id, existingForWorkout.id));
    } else {
      await tx.insert(personalRecord).values({
        id: crypto.randomUUID(),
        userId,
        exerciseId,
        recordType,
        value: candidate,
        dateAchieved,
        workoutId,
        previousRecordValue: priorBest,
      });
    }
    return true;
  }

  // Candidate doesn't beat prior best — delete stale PR row if one exists for this workout
  if (existingForWorkout) {
    await tx
      .delete(personalRecord)
      .where(eq(personalRecord.id, existingForWorkout.id));
  }
  return false;
}

/**
 * Returns a Set of exercise IDs whose cardioSubtype = "running".
 */
export async function loadRunningExerciseIdSet(): Promise<Set<string>> {
  const rows = await db
    .select({ id: exercise.id })
    .from(exercise)
    .where(eq(exercise.cardioSubtype, "running"));
  return new Set(rows.map((r) => r.id));
}

/**
 * Computes and records running PRs (longest_distance + best_pace) for a single
 * exercise log. Skips best_pace if durationMinutes is null.
 */
export async function recordRunningPrs(
  tx: Tx,
  args: {
    userId: string;
    exerciseId: string;
    workoutId: string;
    dateAchieved: Date;
    distanceMeter: number | null | undefined;
    durationMinutes: number | null | undefined;
  },
): Promise<void> {
  const { userId, exerciseId, workoutId, dateAchieved, distanceMeter, durationMinutes } = args;

  await recordPr(tx, {
    userId, exerciseId, workoutId, dateAchieved,
    recordType: "longest_distance",
    candidate: distanceMeter,
  });

  if (distanceMeter && durationMinutes) {
    const paceSecondsPerKm = (durationMinutes * 60) / (distanceMeter / 1000);
    await recordPr(tx, {
      userId, exerciseId, workoutId, dateAchieved,
      recordType: "best_pace",
      candidate: paceSecondsPerKm,
    });
  }
}

type SetLike = {
  weight?: number | null;
  reps?: number | null;
};

/**
 * Computes and records all three strength PRs for a set of exercise sets.
 * Aggregates across all sets (handles supersets/multiple logs for same exercise).
 * Bodyweight sets (weight = null) are excluded from max_weight and max_volume
 * but included in max_reps.
 */
export async function recordStrengthPrs(
  tx: Tx,
  args: {
    userId: string;
    exerciseId: string;
    workoutId: string;
    dateAchieved: Date;
    sets: SetLike[];
  },
): Promise<void> {
  const { userId, exerciseId, workoutId, dateAchieved, sets } = args;

  const weightedSets = sets.filter((s) => s.weight != null);

  const maxWeight = weightedSets.length > 0
    ? Math.max(...weightedSets.map((s) => s.weight!))
    : null;

  const maxReps = sets.filter((s) => s.reps != null).length > 0
    ? Math.max(...sets.filter((s) => s.reps != null).map((s) => s.reps!))
    : null;

  const maxVolume = weightedSets.length > 0
    ? weightedSets.reduce((sum, s) => sum + (s.weight! * (s.reps ?? 0)), 0)
    : null;

  await Promise.all([
    recordPr(tx, { userId, exerciseId, workoutId, dateAchieved, recordType: "max_weight", candidate: maxWeight }),
    recordPr(tx, { userId, exerciseId, workoutId, dateAchieved, recordType: "max_reps", candidate: maxReps }),
    recordPr(tx, { userId, exerciseId, workoutId, dateAchieved, recordType: "max_volume", candidate: maxVolume }),
  ]);
}
```

#### 2. Validation change — `packages/api/src/routers/workouts.ts`

Add zod refinement to the exercise log input schema: if the exercise resolves to a running exercise (via `cardioSubtype = "running"`), `durationMinutes` must be non-null.

Since the check requires a DB lookup, use a superRefine in the router procedure rather than in the base schema:

```ts
// Inside workouts.create and workouts.update, after resolving runningExerciseIdSet:
for (const log of input.logs) {
  if (log.exerciseId && runningExerciseIdSet.has(log.exerciseId) && !log.durationMinutes) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Running exercise log requires durationMinutes`,
    });
  }
}
```

#### 3. Refactor `workouts.create`

- Remove `isBetterRunningPr` (line 78-86), `runningPrByKey` Map, `maybeInsertRunningPr` closure (lines 396-423)
- After each log insert, call `recordRunningPrs` for running exercises and `recordStrengthPrs` for strength exercises
- Group sets by `exerciseId` before calling `recordStrengthPrs` (aggregation rule)

#### 4. Wire into `workouts.update`

After log re-insert loop, re-run PR detection for all logs using the same helpers. The `recordPr` function handles UPDATE/DELETE semantics for existing PR rows.

#### 5. Wire into `tcxImport.commit`

After exerciseLog insert, call `recordRunningPrs`. TCX always resolves to Short/Long Run — exerciseId is never null.

#### 6. Wire into `whoop.commit`, `workoutProcessor`, `triggerBackfill`

Gated on Phase 3 (which fixes `whoop.commit` to set exerciseId). After Phase 3, all three paths call `recordRunningPrs` after the exercise log insert/update.

#### 7. Wire into `import.commit` (markdown)

Call `recordStrengthPrs` for each resolved exercise that has sets with weight/reps data. Leave running PR detection as a TODO — the markdown parser doesn't expose `distanceMeter`.

### Success Criteria

- [ ] `pnpm -w typecheck`
- [ ] Unit tests for `recordPr`:
  - No prior PR + valid candidate → inserts
  - Candidate beats existing → inserts new row (prior row unchanged)
  - Candidate doesn't beat existing → no-op
  - Edit up (same workoutId, higher value) → UPDATEs existing row
  - Edit down below prior best (same workoutId) → DELETEs existing row
  - Null/zero candidate → no-op
  - `best_pace` lower-is-better logic works
- [ ] Unit tests for `recordStrengthPrs`: bodyweight exclusion, aggregation across multiple sets
- [ ] Integration: create 5km run → create 6km run (different workoutId) → assert 2 PR rows with values 5000 and 6000
- [ ] Manual: edit existing run up to new best → verify PR progression shows both entries

---

## Phase 2.5: Backfill Personal Records for Existing Workouts

### What Changes

Admin tRPC endpoint that processes all existing workouts oldest-first per user, running each through the same `recordPr` logic. Makes the PR progression log accurate from day one of the deploy.

### Changes Required

#### 1. Admin endpoint — `packages/api/src/routers/admin.ts`

```ts
backfillPersonalRecords: adminProcedure
  .mutation(async ({ ctx }) => {
    // Fetch all workouts oldest-first, grouped by user
    const workouts = await db
      .select({ /* ... */ })
      .from(workout)
      .orderBy(asc(workout.userId), asc(workout.date));

    const runningIdSet = await loadRunningExerciseIdSet();
    let processed = 0;
    let prsRecorded = 0;

    for (const w of workouts) {
      const logs = await db
        .select({ /* exerciseLog + sets */ })
        .from(exerciseLog)
        .leftJoin(exerciseSet, eq(exerciseSet.exerciseLogId, exerciseLog.id))
        .where(eq(exerciseLog.workoutId, w.id));

      await db.transaction(async (tx) => {
        // Group logs by exerciseId, compute candidates, call recordPr
        // Running logs: recordRunningPrs
        // Strength logs: recordStrengthPrs (aggregated)
      });

      processed++;
    }

    return { processed, prsRecorded };
  }),
```

**Key properties:**
- Processes oldest-first — correct `previousRecordValue` chain
- Idempotent — safe to re-run (unique constraint prevents duplicates)
- Returns count of workouts processed and PRs recorded for observability
- Runs inside transaction per workout — safe on partial failure
- Existing manually-created PR rows from `workouts.create` will be preserved (same workoutId, unique constraint skips re-insert)

### Success Criteria

- [ ] Endpoint accessible only to admin users
- [ ] Running on a user with 10 workouts produces correct progression log (verify oldest PR has `previousRecordValue = null`, each subsequent has prior value)
- [ ] Running twice produces identical results (idempotent)
- [ ] No timeout on large datasets — paginate if needed

---

## Phase 3: Fix `whoop.commit` — Set `exerciseId` and `distanceMeter`

### What Changes

`routers/whoop.ts:538-601` inserts exercise logs with `exerciseId = null` and no `distanceMeter`. After this phase, manual bulk Whoop imports match webhook/backfill schema exactly.

### Changes Required

#### 1. Reuse `whoopActivityToExerciseLog`

Export from `lib/whoop-webhook.ts` if not already. `whoop.commit` currently duplicates this arithmetic inline less completely.

#### 2. Modify insert block (`routers/whoop.ts:538-591`)

Before the workout insert:
```ts
const patch = whoopActivityToExerciseLog(record);
const resolvedExercise = await resolveWhoopExerciseId(
  record.sport_id,
  record.sport_name,
  patch.distanceMeter,
);
```

Update exerciseLog insert to use `resolvedExercise?.id`, `resolvedExercise?.name ?? record.sport_name`, and all fields from `patch`.

#### 3. Add PR tracking (Phase 2 dependency)

```ts
if (resolvedExercise && runningIdSet.has(resolvedExercise.id)) {
  await recordRunningPrs(tx, {
    userId,
    exerciseId: resolvedExercise.id,
    workoutId,
    dateAchieved: workoutDate,
    distanceMeter: patch.distanceMeter,
    durationMinutes: patch.durationMinutes,
  });
}
```

#### 4. Phase 3.1 (optional): Repair historical rows

Existing `whoop.commit` rows have `exerciseId = NULL`. Requires re-fetching from Whoop API — not a SQL migration. Expose as `whoop.repairManualImports` admin procedure if needed.

### Success Criteria

- [ ] Unit test: 5km activity → exerciseId = Short Run exerciseId, distanceMeter = 5000, PR row inserted
- [ ] Unit test: 9km activity → exerciseName = "Long Run"
- [ ] Manual: import run via Whoop modal → appears on Cardio Analytics page

---

## Phase 4: Extract Shared `upsertWhoopWorkout`

### What Changes

`whoop-webhook.ts:194-329` and `whoop-backfill.ts:192-319` are identical three-path dedup logic copy-pasted verbatim. Extract to a single function.

### Changes Required

#### 1. Move shared types

Move `whoopActivityToExerciseLog` and `WhoopActivityDetail` to `packages/api/src/lib/whoop-activity-dto.ts` to avoid circular imports.

#### 2. New lib: `packages/api/src/lib/whoop-upsert.ts`

```ts
export type UpsertWhoopResult =
  | { path: "manual-link"; workoutId: string }
  | { path: "auto-update"; workoutId: string }
  | { path: "new-import"; workoutId: string };

export async function upsertWhoopWorkout(
  userId: string,
  activity: WhoopActivityDetail,
): Promise<UpsertWhoopResult>
```

Three paths (same logic as today, but now with `recordRunningPrs` called in all three):
- **Path 1 (manual-link)**: `source !== "whoop"` — patch log metrics + call `recordRunningPrs`
- **Path 2 (auto-update)**: `source === "whoop"` — update workout + log + call `recordRunningPrs`
- **Path 3 (new-import)**: insert workout + log + call `recordRunningPrs`

All paths update `whoopConnection.lastImportedAt` inside the transaction.

#### 3. Webhook delegates

`lib/whoop-webhook.ts`: Replace 130-line three-path block with:
```ts
const result = await upsertWhoopWorkout(userId, activity);
```

Keep notification emission and recalc calls unchanged.

#### 4. Backfill delegates

`lib/whoop-backfill.ts`: Replace with:
```ts
const result = await upsertWhoopWorkout(userId, activity);
if (result.path !== "manual-link") importedCount++;
```

### Success Criteria

- [ ] All three webhook paths verified: new activity creates workout+notification; refined score updates existing; manual-link preserves date/notes
- [ ] Backfill over 30 days produces no duplicates
- [ ] PR rows created correctly across all three paths

---

## Phase 5: Unify Analytics "What Is a Run?" Filter + Restructure PR Query

### What Changes

1. Replace `isNotNull(workout.whoopActivityId)` with exercise join + `cardioSubtype = "running"` in the three Whoop-scoped analytics procedures
2. Restructure `personalRecords` procedure return shape for 5 PR types + progression timeline

### Changes Required

#### 1. Fix three procedures (`analytics.ts`)

- `runningHrTrend` (lines 439-468)
- `whoopPaceTrend` (lines 474-530)
- `weeklyRunDistance` (lines 536-572)

For each: replace `isNotNull(workout.whoopActivityId)` with:
```ts
.innerJoin(exercise, eq(exerciseLog.exerciseId, exercise.id))
.where(
  and(
    eq(workout.userId, ctx.session.user.id),
    eq(exercise.cardioSubtype, "running"),
    // … date filters unchanged
  ),
)
```

#### 2. Restructure `personalRecords` procedure

**Old return shape**: flat list of rows grouped by exercise  
**New return shape**:
```ts
{
  exerciseId: string;
  exerciseName: string;
  recordsByType: {
    recordType: RecordType;
    currentBest: number;
    progression: {
      value: number;
      dateAchieved: Date;
      previousRecordValue: number | null;
    }[];  // ASC by dateAchieved — oldest to newest
  }[];
}[]
```

Query: fetch all `personal_record` rows for the user, order by `(exerciseId, recordType, dateAchieved ASC)`, group in application code.

Update `groupPersonalRecordsByExercise` in `analytics-queries.ts` to produce new shape.

#### 3. Update web + native clients

- `apps/web/src/components/analytics/personal-records-grid.tsx` — update to render progression timeline per type
- `apps/native/components/analytics/NativePersonalRecords.tsx` — same
- Both show: current best prominently, expandable or inline progression log oldest → newest

#### 4. Integration test

Create one workout per source (manual, TCX, whoop.commit, webhook, backfill) with identical running data. Assert all five analytics procedures include each workout.

### Success Criteria

- [ ] `runningHrTrend` now includes TCX-imported runs (previously excluded by `whoopActivityId IS NOT NULL`)
- [ ] Weekly distance charts agree across `weeklyRunningVolume` and `weeklyRunDistance` for mixed-source users
- [ ] PR grid renders progression timeline for all 5 types
- [ ] `currentBest` is the last (newest) item in each progression array

---

## Phase 6: Fix `volumeOverTime` Blind to Imported Workouts

### What Changes

`workout.totalVolume` is null for all import paths except markdown. Compute it at insert time in every path.

### Changes Required

#### 1. Shared helper: `packages/api/src/lib/workout-utils.ts`

```ts
type SetLike = { reps?: number | null; weight?: number | null; durationSeconds?: number | null };
type ExerciseLogLike = { sets?: SetLike[]; distanceMeter?: number | null };

/**
 * Strength sets: sum(weight * reps). Duration sets: sum(durationSeconds).
 * Cardio logs: distanceMeter. Returns null if total = 0.
 */
export function computeWorkoutTotalVolume(logs: ExerciseLogLike[]): number | null {
  let total = 0;
  for (const log of logs) {
    if (log.sets?.length) {
      for (const set of log.sets) {
        if (set.durationSeconds != null && set.reps == null) {
          total += set.durationSeconds;
        } else {
          total += (set.reps ?? 0) * (set.weight ?? 0);
        }
      }
    } else if (log.distanceMeter != null) {
      total += log.distanceMeter;
    }
  }
  return total > 0 ? total : null;
}
```

#### 2. Wire into all import paths

- `tcxImport.commit`: `totalVolume = computeWorkoutTotalVolume([{ distanceMeter: run.distanceMeter }])`
- `whoop.commit`: same pattern with `patch.distanceMeter`
- `upsertWhoopWorkout` (Phase 4): Path 3 insert + Path 2 update
- `workouts.update`: recompute server-side, ignore client-sent value

#### 3. Backfill historical rows

**File**: `packages/db/src/migrations/0018_backfill_total_volume.sql`

```sql
UPDATE "workout" w
SET "total_volume" = sub.vol
FROM (
  SELECT
    el.workout_id,
    COALESCE(SUM(es.weight * es.reps), 0)
      + COALESCE(SUM(el.distance_meter), 0) AS vol
  FROM exercise_log el
  LEFT JOIN exercise_set es ON es.exercise_log_id = el.id
  GROUP BY el.workout_id
) sub
WHERE w.id = sub.workout_id
  AND w."total_volume" IS NULL
  AND sub.vol > 0;
```

### Success Criteria

- [ ] Unit tests for `computeWorkoutTotalVolume`: strength sets, duration sets, cardio log, empty = null
- [ ] Volume Over Time chart no longer flat for users with only imported workouts

---

## Phase 7 (Stretch): Extract Shared `createWorkoutWithLogs`

### What Changes

Root cause of all divergence: eight paths inline their own `tx.insert(workout)` + `tx.insert(exerciseLog)`. A single helper prevents future drift. Riskiest change — do last.

### New file: `packages/api/src/lib/workout-create.ts`

```ts
export async function createWorkoutWithLogs(
  tx: Tx,
  input: CreateWorkoutInput,
  options?: { runningExerciseIdSet?: Set<string> },
): Promise<{ workoutId: string; logIds: string[] }>
```

Does in order:
1. Insert `workout` row (with `computeWorkoutTotalVolume`)
2. Insert `exerciseLog` + `exerciseSet` rows per log
3. Call `recordRunningPrs` for running logs
4. Call `recordStrengthPrs` (aggregated) for strength logs
5. Return IDs

### Migration order (safest → riskiest)

1. `tcxImport.commit`
2. `whoop.commit`
3. `workouts.create`
4. `import.commit` (markdown)
5. `upsertWhoopWorkout` Path 3

`workouts.update` stays as-is (it updates, doesn't insert).

### Success Criteria

- [ ] Every existing test passes without modification — observable no-op
- [ ] Smoke test all creation paths in web UI

---

## Testing Strategy

### Unit Tests
- `recordPr`: insert/append/no-op/edit-up/edit-down/delete/best_pace-lower-is-better
- `recordStrengthPrs`: bodyweight exclusion, aggregation, parallel PR types
- `recordRunningPrs`: pace computation, missing duration skip
- `computeWorkoutTotalVolume`: all branch types

### Integration Tests
- Create workout from each of 8 paths with identical running data. Assert: `totalVolume` set; `exerciseId` resolves to running exercise; PR rows inserted correctly.
- Backfill endpoint: 10 workouts oldest-first → correct progression with `previousRecordValue` chain
- All 5 analytics procedures include workout from each source after Phase 5

### Manual Testing
1. Apply migration; confirm index present in psql
2. Log new run → verify PR progression appears
3. Edit run up → verify new PR row added to progression
4. Edit run down below prior best → verify PR row deleted
5. Import run via Whoop modal → appears on Cardio Analytics
6. Run backfill endpoint → verify strength PR progression for historical workouts
7. Four running charts show consistent numbers across all import sources

---

## Migration Notes

| File | Phase | Purpose |
|---|---|---|
| `0017_personal_record_unique.sql` | 1 | Add unique index on 4 columns |
| `0018_backfill_total_volume.sql` | 6 | Populate NULL totalVolume rows |

No migration for PR backfill — handled by admin tRPC endpoint.

## References

- PR closure (to delete): `packages/api/src/routers/workouts.ts:396-423`
- `isBetterRunningPr` (to delete): `workouts.ts:78-86`
- Whoop exercise resolver: `packages/api/src/lib/whoop-client.ts:20-44`
- Duplicated three-path logic: `lib/whoop-webhook.ts:194-329` and `lib/whoop-backfill.ts:192-319`
- `whoop.commit` broken resolution: `routers/whoop.ts:538-601`
- Analytics filter gap: `analytics.ts:62-152` vs `analytics.ts:439-572`
- `volumeOverTime` bug: `analytics.ts:340-377`
- Repair migration precedent: `packages/db/src/migrations/0012_repair_exercise_log_metrics.sql`
