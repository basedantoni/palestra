# Progressive Overload Calculation Engine - Implementation Plan

## Overview

Build a progressive overload calculation engine that detects training trends (improving, plateau, declining) per exercise and generates actionable progression suggestions. The engine runs as pure functions triggered after each workout save, persisting results to the existing `progressive_overload_state` table. Suggestions surface in both web and native UIs during workout logging.

## Current State Analysis

### What exists:
- **DB schema** is fully defined and migrated: `progressiveOverloadState` table in `packages/db/src/schema/progressive-overload.ts` (line 16) with `last10Workouts` JSONB, `trendStatus` enum (`improving | plateau | declining`), `plateauCount`, `nextSuggestedProgression` JSONB, and `lastCalculatedAt`.
- **User preferences** include `plateauThreshold` (default 3) in `packages/db/src/schema/user-preferences.ts` (line 22).
- **Analytics router** at `packages/api/src/routers/analytics.ts` (line 40) has a `progressiveOverload` query that reads raw rows from the table but performs no calculation.
- **Workouts router** at `packages/api/src/routers/workouts.ts` handles `create` (line 131) and `update` (line 190) mutations with full exercise log + set insertion, but has no post-save hook.
- **Exercise schema** at `packages/db/src/schema/exercise.ts` includes `exerciseType` (weightlifting, hiit, cardio, etc.) which determines which recommendation strategy applies.
- **Workout data model**: `workout` -> `exerciseLog` (has `exerciseId`, `exerciseName`) -> `exerciseSet` (has `setNumber`, `reps`, `weight`, `rpe`). All in `packages/db/src/schema/workout.ts`.
- **Existing pure-function pattern**: `packages/api/src/lib/workout-utils.ts` + `packages/api/src/lib/workout-utils.test.ts` -- 186-line util file with 607-line test file, using Vitest with `globals: true`.

### Key constraints:
- The `progressiveOverloadState` table uses a UUID `id` primary key (not a composite key on userId+exerciseId), so we need upsert logic keyed on `(userId, exerciseId)`.
- `exerciseSet.rpe` is an integer 1-10 (nullable).
- `exerciseLog.exerciseId` is nullable (user can log exercises without linking to the exercise catalog). Progressive overload tracking only applies when `exerciseId` is present.
- The engine should only run for weightlifting-type exercises initially (the `exerciseType` field on the `exercise` table determines this).

## Desired End State

After implementation:
1. Every time a workout is saved (create or update), the system recalculates progressive overload state for each exercise in that workout that has a linked `exerciseId` and is of type `weightlifting` or `calisthenics`.
2. The `progressive_overload_state` row for each (userId, exerciseId) pair is upserted with current trend detection and a concrete suggestion.
3. The `analytics.progressiveOverload` query returns enriched data including human-readable suggestion text.
4. Both web and native UIs show the suggestion inline when the user begins logging sets for a previously-tracked exercise.

### Verification:
- Unit tests cover all pure calculation functions with edge cases.
- Integration: saving a workout with 3+ sessions of flat performance produces a `plateau` status and a suggestion of `+1 set` or `deload`.
- UI: when starting a new workout with a previously-tracked exercise, the suggestion badge is visible.

## What We're NOT Doing

- **Cardio/HIIT/yoga progression logic**: Only weightlifting and calisthenics exercises get trend detection in this phase. Other types return `null` suggestions.
- **User-configurable progression percentages**: We use sensible defaults (2.5-5% weight increase, 10% deload). Configuration comes later.
- **Push notifications or reminders**: Suggestions are passive, shown inline only.
- **Historical trend charts**: The analytics query returns the current state. Charting is a separate feature.
- **Machine learning or complex periodization**: The engine uses simple heuristic rules.

## Implementation Approach

All calculation logic lives as pure functions in `packages/api/src/lib/progressive-overload.ts`, tested exhaustively in `packages/api/src/lib/progressive-overload.test.ts`. A thin orchestrator function handles DB reads/writes and is called from the workout mutation. The analytics router is enhanced to return formatted suggestions.

---

## Phase 1: Pure Calculation Functions (TDD)

### Overview
Write all progressive overload detection and recommendation logic as pure, stateless functions with comprehensive tests. No DB interaction in this phase.

### Changes Required:

#### 1. Type definitions
**File**: `packages/api/src/lib/progressive-overload.ts` (new file)

Define the input/output types that the pure functions operate on:

```typescript
// --- Input types (what we extract from DB) ---

export interface SetSnapshot {
  reps: number;
  weight: number; // in user's preferred unit
  rpe: number | null;
}

export interface ExerciseSessionSnapshot {
  date: Date;
  sets: SetSnapshot[];
  totalVolume: number; // sum of (reps * weight) across sets
  topSetWeight: number; // heaviest weight used
  topSetReps: number; // most reps in any single set
  averageRpe: number | null; // average RPE across sets, null if no RPE data
  numberOfSets: number;
}

// --- Output types ---

export type TrendStatus = "improving" | "plateau" | "declining";

export type ProgressionType =
  | "increase_weight"
  | "increase_reps"
  | "add_set"
  | "deload"
  | "maintain";

export interface ProgressionSuggestion {
  type: ProgressionType;
  message: string; // Human-readable, e.g. "Increase weight to 142.5 lbs"
  details: {
    currentValue: number;
    suggestedValue: number;
    unit: string; // "lbs", "kg", "reps", "sets"
  };
}

export interface OverloadAnalysis {
  trendStatus: TrendStatus;
  plateauCount: number;
  suggestion: ProgressionSuggestion | null;
}
```

#### 2. Snapshot builder
**File**: `packages/api/src/lib/progressive-overload.ts`

Convert raw set data into a session snapshot:

```typescript
export function buildSessionSnapshot(
  date: Date,
  sets: Array<{ reps: number | null; weight: number | null; rpe: number | null }>,
): ExerciseSessionSnapshot {
  const validSets = sets.filter(
    (s): s is { reps: number; weight: number; rpe: number | null } =>
      s.reps != null && s.weight != null,
  );

  const totalVolume = validSets.reduce((sum, s) => sum + s.reps * s.weight, 0);
  const topSetWeight = validSets.length > 0
    ? Math.max(...validSets.map((s) => s.weight))
    : 0;
  const topSetReps = validSets.length > 0
    ? Math.max(...validSets.map((s) => s.reps))
    : 0;
  const rpeSets = validSets.filter((s) => s.rpe != null);
  const averageRpe = rpeSets.length > 0
    ? rpeSets.reduce((sum, s) => sum + s.rpe!, 0) / rpeSets.length
    : null;

  return {
    date,
    sets: validSets.map((s) => ({ reps: s.reps, weight: s.weight, rpe: s.rpe })),
    totalVolume,
    topSetWeight,
    topSetReps,
    averageRpe,
    numberOfSets: validSets.length,
  };
}
```

#### 3. Trend detection
**File**: `packages/api/src/lib/progressive-overload.ts`

```typescript
/**
 * Detect the overall trend from the last N sessions.
 *
 * - "improving": volume or top-set weight increased in at least 2 of last 3 sessions
 * - "plateau": volume AND top-set weight stayed within +/- 2.5% for `plateauThreshold` consecutive sessions
 * - "declining": volume or top-set weight decreased in at least 2 of last 3 sessions, OR average RPE > 8 for 3+ sessions
 */
export function detectTrend(
  sessions: ExerciseSessionSnapshot[], // ordered oldest-first, at least 2
  plateauThreshold: number,
): { trendStatus: TrendStatus; plateauCount: number } {
  // Implementation details:
  // 1. Compare each consecutive pair of sessions
  // 2. A session "improved" if totalVolume increased by > 2.5% OR topSetWeight increased
  // 3. A session "declined" if totalVolume decreased by > 2.5% AND topSetWeight did not increase
  // 4. Otherwise it's "flat"
  // 5. Count consecutive flat sessions from the most recent backward for plateauCount
  // 6. If plateauCount >= plateauThreshold -> "plateau"
  // 7. If 2+ of last 3 comparisons improved -> "improving"
  // 8. If 2+ of last 3 comparisons declined -> "declining"
  // 9. If high RPE (avg > 8) for 3+ consecutive recent sessions -> "declining" (fatigue signal)
  // 10. Default: "plateau" with current plateauCount
}
```

#### 4. Recommendation engine
**File**: `packages/api/src/lib/progressive-overload.ts`

```typescript
/**
 * Generate a progression suggestion based on trend status and recent session data.
 */
export function generateSuggestion(
  trendStatus: TrendStatus,
  plateauCount: number,
  latestSession: ExerciseSessionSnapshot,
  weightUnit: "lbs" | "kg",
): ProgressionSuggestion | null {
  // Rules:
  //
  // IMPROVING (consistent achievement):
  //   - Suggest weight increase: 2.5% for upper body, 5% for lower body
  //     (we use a flat 2.5-5% since we don't know body part here; use 5 lbs / 2.5 kg rounding)
  //   - If weight is already very high relative to reps (<=3 reps), suggest +1-2 reps instead
  //
  // PLATEAU:
  //   - plateauCount < 4: suggest adding +1 set (if currently < 6 sets)
  //   - plateauCount >= 4: suggest deload (reduce weight by 10%, reset to base reps)
  //
  // DECLINING:
  //   - If averageRpe > 8: suggest maintaining current weight but reducing volume (drop 1 set)
  //   - Otherwise: suggest maintaining current weight and focus on form
  //
  // Returns null if < 2 sessions of data
}

/**
 * Round a weight to the nearest practical increment.
 * - lbs: round to nearest 2.5
 * - kg: round to nearest 1.25
 */
export function roundToNearestIncrement(
  weight: number,
  unit: "lbs" | "kg",
): number {
  const increment = unit === "lbs" ? 2.5 : 1.25;
  return Math.round(weight / increment) * increment;
}
```

#### 5. Top-level analyze function
**File**: `packages/api/src/lib/progressive-overload.ts`

```typescript
/**
 * Main entry point: given a list of recent sessions (up to 10, oldest first)
 * and user config, produce the full overload analysis.
 */
export function analyzeProgressiveOverload(
  sessions: ExerciseSessionSnapshot[],
  config: {
    plateauThreshold: number; // from user preferences, default 3
    weightUnit: "lbs" | "kg";
  },
): OverloadAnalysis {
  if (sessions.length < 2) {
    return {
      trendStatus: "improving", // assume improving for new exercises
      plateauCount: 0,
      suggestion: null,
    };
  }

  const { trendStatus, plateauCount } = detectTrend(sessions, config.plateauThreshold);
  const latestSession = sessions[sessions.length - 1]!;
  const suggestion = generateSuggestion(trendStatus, plateauCount, latestSession, config.weightUnit);

  return { trendStatus, plateauCount, suggestion };
}
```

#### 6. Tests
**File**: `packages/api/src/lib/progressive-overload.test.ts` (new file)

Test cases to write (organized by function):

```typescript
describe("progressive-overload", () => {

  describe("buildSessionSnapshot", () => {
    it("should compute totalVolume as sum of reps*weight across valid sets");
    it("should find topSetWeight as the max weight");
    it("should find topSetReps as the max reps");
    it("should compute averageRpe ignoring null RPE values");
    it("should return averageRpe as null when no sets have RPE");
    it("should filter out sets with null reps or weight");
    it("should handle empty sets array");
  });

  describe("detectTrend", () => {
    it("should return 'improving' when volume increased in 2 of 3 recent sessions");
    it("should return 'improving' when top-set weight increased in 2 of 3 recent sessions");
    it("should return 'plateau' when volume is flat for plateauThreshold sessions");
    it("should return 'plateau' with correct plateauCount");
    it("should return 'declining' when volume decreased in 2 of 3 recent sessions");
    it("should return 'declining' when average RPE > 8 for 3+ consecutive sessions");
    it("should handle exactly 2 sessions");
    it("should use the configured plateauThreshold (not hardcoded)");
    it("should treat +/- 2.5% volume change as flat");
    it("should count plateau from most recent session backward");
  });

  describe("generateSuggestion", () => {
    it("should suggest weight increase when improving");
    it("should round weight suggestion to nearest 2.5 lbs");
    it("should round weight suggestion to nearest 1.25 kg");
    it("should suggest rep increase when improving and reps <= 3");
    it("should suggest adding a set when plateaued with low plateauCount");
    it("should not suggest adding a set beyond 6 sets");
    it("should suggest deload when plateaued for 4+ sessions");
    it("should suggest maintaining when declining with high RPE");
    it("should suggest maintaining when declining without high RPE");
    it("should return a human-readable message string");
  });

  describe("roundToNearestIncrement", () => {
    it("should round lbs to nearest 2.5");
    it("should round kg to nearest 1.25");
    it("should handle exact multiples");
  });

  describe("analyzeProgressiveOverload", () => {
    it("should return null suggestion with fewer than 2 sessions");
    it("should return 'improving' default status with fewer than 2 sessions");
    it("should combine trend detection and suggestion generation");
    it("should pass plateauThreshold from config to detectTrend");

    // Integration-style tests with realistic data
    it("scenario: 3 sessions of increasing bench press weight -> improving + weight increase suggestion");
    it("scenario: 4 sessions of flat squat volume -> plateau + add set suggestion");
    it("scenario: 5 sessions of flat volume -> plateau + deload suggestion");
    it("scenario: 3 sessions of declining volume with high RPE -> declining + maintain suggestion");
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] File exists: `packages/api/src/lib/progressive-overload.ts`
- [x] File exists: `packages/api/src/lib/progressive-overload.test.ts`
- [x] All tests pass: `cd packages/api && npx vitest run src/lib/progressive-overload.test.ts`
- [x] TypeScript compiles: `cd packages/api && npx tsc --noEmit`
- [x] At least 30 test cases covering all exported functions
- [x] Zero test failures

#### Manual Verification:
- [ ] Review that suggestion messages are clear and actionable (e.g., "Increase weight to 142.5 lbs" not "increase_weight: 142.5")
- [ ] Verify the 2.5% threshold for flat detection feels right with real-world numbers
- [ ] Confirm deload suggestion (10% reduction) produces sensible weights

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the test scenarios match real-world training patterns before proceeding to the next phase.

---

## Phase 2: Database Orchestrator

### Overview
Build the orchestration layer that reads exercise history from the DB, calls the pure functions, and upserts results into `progressive_overload_state`. This is a thin layer -- all logic lives in the Phase 1 functions.

### Changes Required:

#### 1. Orchestrator function
**File**: `packages/api/src/lib/progressive-overload-db.ts` (new file)

```typescript
import { and, eq, desc } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  exerciseLog,
  exerciseSet,
  workout,
  progressiveOverloadState,
  userPreferences,
  exercise,
} from "@src/db/schema/index";

import {
  buildSessionSnapshot,
  analyzeProgressiveOverload,
  type ExerciseSessionSnapshot,
  type OverloadAnalysis,
} from "./progressive-overload";

/**
 * Recalculate progressive overload state for specific exercises after a workout save.
 *
 * @param db - Drizzle database instance (or transaction)
 * @param userId - The user who saved the workout
 * @param exerciseIds - The exercise IDs from the saved workout to recalculate
 */
export async function recalculateProgressiveOverload(
  db: PostgresJsDatabase<typeof import("@src/db/schema/index")>,
  userId: string,
  exerciseIds: string[],
): Promise<void> {
  // 1. Fetch user preferences (plateauThreshold, weightUnit)
  // 2. For each exerciseId:
  //    a. Verify exercise is weightlifting/calisthenics type (skip others)
  //    b. Fetch last 10 workout sessions containing this exercise, ordered by date desc
  //       JOIN exerciseLog -> exerciseSet, WHERE exerciseLog.exerciseId = exerciseId
  //       AND workout.userId = userId
  //    c. Build ExerciseSessionSnapshot[] from the raw data (using buildSessionSnapshot)
  //    d. Call analyzeProgressiveOverload(snapshots, config)
  //    e. Upsert into progressive_overload_state:
  //       - ON CONFLICT (userId, exerciseId) -> see note below about unique constraint
  //       - Set last10Workouts = snapshots as JSONB
  //       - Set trendStatus, plateauCount, nextSuggestedProgression, lastCalculatedAt
}
```

**Important**: The `progressive_overload_state` table uses a UUID `id` PK, not a composite unique constraint on `(userId, exerciseId)`. We need to either:
- Add a unique index on `(userId, exerciseId)` via a new migration, OR
- Use a select-then-insert/update pattern.

**Decision**: Use select-then-insert/update (no migration needed). The function will:
1. `SELECT id FROM progressive_overload_state WHERE userId = ? AND exerciseId = ?`
2. If found: `UPDATE ... WHERE id = ?`
3. If not found: `INSERT ... VALUES (...)`

This avoids a schema migration and keeps Phase 2 purely additive.

#### 2. Unique index migration (optional but recommended)
**File**: `packages/db/src/schema/progressive-overload.ts`

Add a unique index to enable proper upsert semantics in the future:

```typescript
// In the table definition's index array, add:
index("progressive_overload_state_userId_exerciseId_uniq")
  .on(table.userId, table.exerciseId)
  .unique(),
```

This is a non-breaking additive migration. Run `pnpm drizzle-kit generate` and `pnpm drizzle-kit migrate` after adding it. If existing data has duplicates (unlikely since the table is empty), deduplicate first.

#### 3. Hook into workout mutations
**File**: `packages/api/src/routers/workouts.ts`

Modify the `create` and `update` mutations to call `recalculateProgressiveOverload` after the transaction completes.

In the `create` mutation (after line 188, after `return createdWorkout`):

```typescript
// After the transaction, trigger progressive overload recalculation
// Extract exerciseIds from the input logs (only those with exerciseId)
const exerciseIds = input.logs
  .map((log) => log.exerciseId)
  .filter((id): id is string => id != null);

if (exerciseIds.length > 0) {
  // Fire and forget -- don't block the response on recalculation
  // Use a separate non-transactional DB call
  recalculateProgressiveOverload(db, ctx.session.user.id, exerciseIds)
    .catch((err) => console.error("Progressive overload recalc failed:", err));
}
```

Apply the same pattern to the `update` mutation (after line 256).

**Design decision**: Fire-and-forget (non-blocking). The workout save should not fail if recalculation fails. We log errors but don't surface them to the user. This also means the `recalculateProgressiveOverload` function runs outside the workout transaction, reading the committed data.

### Success Criteria:

#### Automated Verification:
- [x] File exists: `packages/api/src/lib/progressive-overload-db.ts`
- [x] TypeScript compiles: `cd packages/api && npx tsc --noEmit`
- [ ] Unique index migration generated (if doing the optional migration): `pnpm drizzle-kit generate`
- [x] Existing tests still pass: `cd packages/api && npx vitest run`

#### Manual Verification:
- [ ] Create a workout via the API with 2+ exercises that have `exerciseId` set
- [ ] Verify `progressive_overload_state` rows are created/updated for those exercises
- [ ] Verify the `last10Workouts` JSONB contains correct snapshot data
- [ ] Create 3+ workouts for the same exercise and verify `trendStatus` reflects the trend
- [ ] Verify non-weightlifting exercises are skipped

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the DB orchestration works correctly with real workout data before proceeding to the next phase.

---

## Phase 3: Enhanced Analytics API

### Overview
Enrich the `analytics.progressiveOverload` query to return structured suggestion data that the UI can render directly, instead of raw DB rows.

### Changes Required:

#### 1. Enhanced query response
**File**: `packages/api/src/routers/analytics.ts`

Replace the current raw `progressiveOverload` query (lines 40-65) with an enriched version:

```typescript
progressiveOverload: protectedProcedure
  .input(
    z
      .object({
        exerciseId: z.string().uuid().optional(),
      })
      .optional(),
  )
  .query(async ({ ctx, input }) => {
    const clauses = [
      eq(progressiveOverloadState.userId, ctx.session.user.id),
    ];
    if (input?.exerciseId) {
      clauses.push(eq(progressiveOverloadState.exerciseId, input.exerciseId));
    }

    const rows = await db
      .select({
        exerciseId: progressiveOverloadState.exerciseId,
        trendStatus: progressiveOverloadState.trendStatus,
        plateauCount: progressiveOverloadState.plateauCount,
        nextSuggestedProgression: progressiveOverloadState.nextSuggestedProgression,
        lastCalculatedAt: progressiveOverloadState.lastCalculatedAt,
        exerciseName: exercise.name,
      })
      .from(progressiveOverloadState)
      .leftJoin(exercise, eq(progressiveOverloadState.exerciseId, exercise.id))
      .where(and(...clauses));

    return rows.map((row) => ({
      exerciseId: row.exerciseId,
      exerciseName: row.exerciseName,
      trendStatus: row.trendStatus,
      plateauCount: row.plateauCount,
      suggestion: row.nextSuggestedProgression as {
        type: string;
        message: string;
        details: { currentValue: number; suggestedValue: number; unit: string };
      } | null,
      lastCalculatedAt: row.lastCalculatedAt,
    }));
  }),
```

#### 2. Add a new query for per-exercise suggestion (used during workout logging)
**File**: `packages/api/src/routers/analytics.ts`

```typescript
exerciseSuggestion: protectedProcedure
  .input(z.object({ exerciseId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const [row] = await db
      .select({
        trendStatus: progressiveOverloadState.trendStatus,
        nextSuggestedProgression: progressiveOverloadState.nextSuggestedProgression,
        lastCalculatedAt: progressiveOverloadState.lastCalculatedAt,
      })
      .from(progressiveOverloadState)
      .where(
        and(
          eq(progressiveOverloadState.userId, ctx.session.user.id),
          eq(progressiveOverloadState.exerciseId, input.exerciseId),
        ),
      )
      .limit(1);

    if (!row) return null;

    return {
      trendStatus: row.trendStatus as "improving" | "plateau" | "declining",
      suggestion: row.nextSuggestedProgression as {
        type: string;
        message: string;
        details: { currentValue: number; suggestedValue: number; unit: string };
      } | null,
      lastCalculatedAt: row.lastCalculatedAt,
    };
  }),
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `cd packages/api && npx tsc --noEmit`
- [x] Existing tests still pass: `cd packages/api && npx vitest run`

#### Manual Verification:
- [ ] Call `analytics.progressiveOverload` via tRPC and verify the response shape includes `suggestion.message`
- [ ] Call `analytics.exerciseSuggestion` with a known exerciseId and verify it returns the suggestion
- [ ] Call `analytics.exerciseSuggestion` with an exerciseId that has no state and verify it returns `null`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the API responses are correct before proceeding to UI work.

---

## Phase 4: Web UI - Suggestion Display

### Overview
Show progressive overload suggestions in the web app in two places: (1) on the workout logging form next to each exercise, and (2) on a dedicated analytics/progress page.

### Changes Required:

#### 1. Suggestion badge component
**File**: `apps/web/src/components/workout/suggestion-badge.tsx` (new file)

A small inline component that shows the suggestion for an exercise:

```tsx
// Renders a colored badge based on trend status:
// - improving: green badge with suggestion text
// - plateau: amber badge with suggestion text
// - declining: red badge with suggestion text
// Uses the existing Badge component from apps/web/src/components/ui/badge.tsx
//
// Props:
// - trendStatus: "improving" | "plateau" | "declining"
// - suggestion: { type: string; message: string } | null
// - compact?: boolean (for inline use in the workout form)
```

#### 2. Hook for fetching suggestion
**File**: `apps/web/src/components/workout/use-exercise-suggestion.ts` (new file)

```typescript
// Custom hook wrapping trpc.analytics.exerciseSuggestion.useQuery
// - Takes exerciseId (string | undefined)
// - Returns { suggestion, trendStatus, isLoading }
// - Only fetches when exerciseId is defined
// - Uses staleTime of 5 minutes (suggestions don't change during a workout session)
```

#### 3. Integrate into workout logging form
**File**: Whichever component in `apps/web/src/components/workout/` renders the exercise entry during logging.

Add the suggestion badge below each exercise name when the exercise has a linked `exerciseId`:

```tsx
// Inside the exercise card/row:
{exercise.exerciseId && (
  <ExerciseSuggestionBadge exerciseId={exercise.exerciseId} />
)}
```

#### 4. Progressive overload summary on analytics/workouts page
**File**: `apps/web/src/routes/workouts/` (in the appropriate route file)

Add a section that lists all exercises with their current trend and suggestion, using `trpc.analytics.progressiveOverload.useQuery()`.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `cd apps/web && npx tsc --noEmit` (no errors in Phase 4 files; pre-existing onboarding errors unrelated)
- [ ] Build succeeds: `cd apps/web && npx vite build`

#### Manual Verification:
- [ ] Navigate to the workout logging form and verify suggestion badges appear for exercises with history
- [ ] Verify the badge color matches the trend status (green/amber/red)
- [ ] Verify the suggestion message text is readable and useful
- [ ] Verify exercises without history show no badge (no error)
- [ ] Verify the analytics page shows a summary of all tracked exercises

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation of the web UI before proceeding to the native app.

---

## Phase 5: Native App - Suggestion Display

### Overview
Mirror the web UI suggestions in the React Native app, showing them during workout logging.

### Changes Required:

#### 1. Suggestion badge component
**File**: `apps/native/components/workout/SuggestionBadge.tsx` (new file)

React Native equivalent of the web badge component. Uses React Native `View` + `Text` with colored backgrounds:
- Improving: green-100 bg, green-800 text
- Plateau: amber-100 bg, amber-800 text
- Declining: red-100 bg, red-800 text

#### 2. Hook for fetching suggestion
**File**: `apps/native/components/workout/useExerciseSuggestion.ts` (new file)

Same pattern as web -- wraps the tRPC query with staleTime.

#### 3. Integrate into workout logging screen
**File**: `apps/native/app/new-workout.tsx` or the relevant exercise entry component in `apps/native/components/workout/`

Add the suggestion badge below each exercise name when the exercise has a linked `exerciseId`.

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `cd apps/native && npx tsc --noEmit`

#### Manual Verification:
- [ ] Open the native app and navigate to workout logging
- [ ] Verify suggestion badges appear for exercises with history
- [ ] Verify badge styling is consistent with the app's design language
- [ ] Verify no crashes when suggestion data is null/loading

**Implementation Note**: After completing this phase, all features are implemented. Perform a full end-to-end test.

---

## Testing Strategy

### Unit Tests (Phase 1 -- `packages/api/src/lib/progressive-overload.test.ts`):
- **buildSessionSnapshot**: 7+ tests covering valid sets, null filtering, empty arrays, RPE averaging
- **detectTrend**: 10+ tests covering improving/plateau/declining detection, RPE-based declining, configurable threshold, edge cases (exactly 2 sessions)
- **generateSuggestion**: 9+ tests covering each recommendation branch, weight rounding, unit handling, set cap
- **roundToNearestIncrement**: 3+ tests for lbs/kg rounding
- **analyzeProgressiveOverload**: 4+ integration-style scenario tests with realistic workout data

### Integration Testing (Manual, Phase 2):
- Create a sequence of 5 workouts with increasing bench press weight -> verify "improving" status
- Create 4 workouts with identical squat numbers -> verify "plateau" with count 4 and deload suggestion
- Create 3 workouts with decreasing deadlift weight and RPE 9 -> verify "declining" status

### End-to-End Testing (Manual, Phase 4-5):
- Full flow: create workout -> verify suggestion appears on next workout logging session
- Verify suggestion updates after saving a new workout

## Performance Considerations

- **Query efficiency**: The orchestrator fetches last 10 workouts per exercise. With proper indexes on `exerciseLog.exerciseId` and `workout.userId + workout.date` (both already exist), this should be fast.
- **Fire-and-forget**: Recalculation runs outside the workout save transaction. Users get instant feedback on save, and suggestions update asynchronously.
- **Batch processing**: The orchestrator loops through `exerciseIds` sequentially. If a workout has many exercises (10+), consider batching, but this is unlikely to be a bottleneck.
- **Client-side caching**: The `exerciseSuggestion` query uses a 5-minute staleTime so it doesn't re-fetch on every component render during a workout session.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/api/src/lib/progressive-overload.ts` | Create | Pure calculation functions (types, snapshot builder, trend detection, suggestion generation) |
| `packages/api/src/lib/progressive-overload.test.ts` | Create | Comprehensive Vitest tests (30+ test cases) |
| `packages/api/src/lib/progressive-overload-db.ts` | Create | DB orchestrator (read history, call pure functions, upsert state) |
| `packages/api/src/routers/workouts.ts` | Modify | Add post-save hook calling recalculateProgressiveOverload |
| `packages/api/src/routers/analytics.ts` | Modify | Enrich progressiveOverload query, add exerciseSuggestion query |
| `packages/db/src/schema/progressive-overload.ts` | Modify (optional) | Add unique index on (userId, exerciseId) |
| `apps/web/src/components/workout/suggestion-badge.tsx` | Create | Web suggestion badge component |
| `apps/web/src/components/workout/use-exercise-suggestion.ts` | Create | Web hook for fetching suggestion |
| `apps/native/components/workout/SuggestionBadge.tsx` | Create | Native suggestion badge component |
| `apps/native/components/workout/useExerciseSuggestion.ts` | Create | Native hook for fetching suggestion |

## References

- Existing pure-function pattern: `packages/api/src/lib/workout-utils.ts` (line 1-186)
- Existing test pattern: `packages/api/src/lib/workout-utils.test.ts` (line 1-607)
- Progressive overload DB schema: `packages/db/src/schema/progressive-overload.ts` (line 16-36)
- Workout mutations: `packages/api/src/routers/workouts.ts` (create: line 131, update: line 190)
- Analytics router: `packages/api/src/routers/analytics.ts` (line 40-65)
- User preferences (plateauThreshold): `packages/db/src/schema/user-preferences.ts` (line 22)
- Exercise schema (exerciseType): `packages/db/src/schema/exercise.ts` (line 35)
- Trend status enum: `packages/db/src/schema/enums.ts` (line 71-75)
