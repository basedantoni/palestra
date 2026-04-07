# Workout Log Import Feature - Implementation Plan

## Overview

Build a multi-step import wizard that lets users upload a markdown workout log file, parse it into structured workout data, resolve exercise names against the existing exercise library via fuzzy matching, preview the results, and commit everything to the database in a single batch.

## Current State Analysis

- Workouts are created one at a time via `workouts.create` mutation in `packages/api/src/routers/workouts.ts` (line 187)
- The existing create mutation writes a single `workout` row, then iterates over `logs` inserting `exerciseLog` + `exerciseSet` rows inside a transaction (lines 190-245)
- Exercise library lives in `packages/db/src/schema/exercise.ts` with name, category, exerciseType, isCustom, status fields
- Custom exercises use `status: "pending"` and go through an admin review queue
- The web app uses TanStack Router with file-based routing at `apps/web/src/routes/`
- UI uses shadcn/ui components (Card, Button, Dialog, Tabs, Badge, etc.) at `apps/web/src/components/ui/`
- Pure business logic lives in `packages/api/src/lib/` (e.g., `workout-utils.ts`, `progressive-overload.ts`)
- tRPC routers registered in `packages/api/src/routers/index.ts` (line 11-29)

### Key Discoveries:
- `exerciseSet` requires either `reps` or `durationSeconds` per the Zod validation in `workouts.ts:28-38`
- `workout.totalVolume` is computed client-side via `calculateTotalVolume()` in `workout-utils.ts:143-149` before being sent to the API
- The fire-and-forget progressive overload recalc pattern (lines 248-262) should be replicated for batch import
- Exercise names are stored both on the `exerciseLog` (denormalized `exerciseName`) and via FK `exerciseId`
- No existing fuzzy match logic exists in the codebase -- needs to be built from scratch

## Desired End State

After this plan is complete:

1. A user can navigate to `/import` on the web app, upload a `.md` file, and import all their historical workouts in one flow
2. The import wizard has 4 steps: Upload -> Exercise Resolution -> Preview -> Confirm
3. Parsed exercise names are fuzzy-matched against the exercise library; unmatched names can be mapped or created as new exercises inline
4. All workouts, exercise logs, and exercise sets are written to the DB in a single transaction
5. Progressive overload and muscle group volume recalculations are triggered post-import
6. Duplicate date detection warns the user before committing

### Verification:
- Unit tests for the parser cover all format patterns from the markdown file
- Unit tests for the fuzzy matcher verify threshold behavior
- The import flow works end-to-end via the web UI
- Imported workouts appear correctly on the workouts list and calendar pages
- Imported data matches the source markdown file when spot-checked

## What We're NOT Doing

- Native app (Expo) import UI -- web only for now
- Support for file formats other than this specific markdown format
- Bulk edit/delete of imported workouts after import
- Server-side file storage -- the file content is sent as a text string via tRPC
- Background job / async processing -- the import runs synchronously in a single request
- Re-import / incremental sync -- this is a one-shot import (with duplicate date warning)

## Implementation Approach

Build bottom-up: parser (pure function, fully testable) -> fuzzy matcher -> tRPC router -> web UI wizard. Each phase is independently testable before moving to the next.

---

## Phase 1: Markdown Parser (Pure Function + Tests)

### Overview
Build a pure TypeScript function that takes raw markdown text and returns structured workout data. No DB access, no side effects.

### Changes Required:

#### 1. Parser Module
**File**: `packages/api/src/lib/workout-import-parser.ts` (new)

```typescript
// ---- Types ----

export interface ParsedSet {
  setNumber: number;
  reps: number | undefined;
  weight: number | undefined;
  rpe: number | undefined;
  durationSeconds: number | undefined;
}

export interface ParsedExercise {
  name: string;           // raw name from markdown (e.g., "Zercher Squats")
  sets: ParsedSet[];
  notes: string;          // any extra text, sub-bullets, parenthetical notes
  isSkipped: boolean;     // true if wrapped in ~~strikethrough~~
  // HIIT/EMOM fields
  rounds: number | undefined;
  workDurationSeconds: number | undefined;
  restDurationSeconds: number | undefined;
}

export interface ParsedWorkout {
  date: Date;             // parsed from YYYYMMDD
  exercises: ParsedExercise[];
  isRestDay: boolean;     // true if "Rest Day", "Skipped", "Recovery", "Mobility", etc.
  rawText: string;        // original text block for this day (useful for preview)
}

export interface ParseResult {
  workouts: ParsedWorkout[];
  uniqueExerciseNames: string[]; // deduplicated, excludes rest days and skipped exercises
  parseWarnings: ParseWarning[];
}

export interface ParseWarning {
  date: string;           // YYYYMMDD
  line: string;           // the problematic line
  message: string;        // human-readable warning
}

export function parseWorkoutMarkdown(markdown: string): ParseResult;
```

**Parsing rules (in order of evaluation per line):**

1. **Date line**: Matches `**YYYYMMDD**` -- starts a new workout block. Parse to `Date` at noon UTC to avoid timezone issues (same pattern as `normalizeDateToLocalNoon` in `workout-utils.ts:112`).

2. **Rest/skip day**: If the entire day block matches any of these patterns (case-insensitive), mark `isRestDay: true` and skip exercise parsing:
   - Contains "rest" or "skip" or "skipped" or "recovery" or "mobility" or "debauchery" or "hangover"
   - The line is a single non-exercise phrase (no `x` pattern)

3. **Strikethrough**: Line wrapped in `~~...~~` -- parse the exercise normally but set `isSkipped: true`. Strip `~~` before further parsing.

4. **Sub-bullet**: Line starting with `*` -- append to the **previous** exercise's `notes` field. Also parse if it contains structured set data (e.g., `* Medicine Ball Russian Twist 3 x 50 @ 15lbs` under "Core Stability" -- these are child exercises, not notes).
   - **Heuristic**: If the sub-bullet contains the `N x N` pattern, treat it as a separate exercise (child of the parent), not as a note. The parent exercise (e.g., "Core Stability") becomes a note-only entry with no sets.
   - If the sub-bullet does NOT contain `N x N` pattern, treat it as notes on the previous exercise (e.g., `* 10 sets, 15s @ 80%, 45s off` for "Assault Treadmill Sprints").

5. **Standard exercise**: `Name N x R @ Wunit` with optional modifiers. Parse with this regex strategy:
   - **Name**: Everything before the first `N x` pattern (trim trailing ` -` or ` -`)
   - **Sets x Reps**: `(\d+)\s*x\s*(\d+)` -- first number is sets, second is reps
   - **Timed sets**: `(\d+)\s*x\s*(\d+)s` -- second number is seconds (when `s` suffix present), map to `durationSeconds` instead of reps
   - **Weight**: `@\s*([\d.]+)\s*(lbs|lb|kg)?` -- numeric weight after `@`
   - **Bodyweight**: `@ BW` or `@ BW` -- weight = 0, add "Bodyweight" to notes
   - **RPE**: `rpe\s*(\d+)` (case-insensitive) at end of line
   - **Per-set overrides**: `N on Nth set` or `last set N` or `N on last set` -- create individual sets with different rep counts rather than uniform sets
   - **Height notation**: `@ 24"` -- not a weight, store in notes (e.g., for Box Jumps)

6. **EMOM pattern**: `N Name EMOM x R @ Wunit` (e.g., `30 KB Swings EMOM x 5 @ 40lbs`):
   - `30` = reps per round
   - `EMOM x 5` = 5 rounds
   - `@ 40lbs` = weight
   - Map to: `rounds: 5`, individual sets each with `reps: 30, weight: 40`

7. **Cardio-only exercises**: Lines like `Stairmaster 5 mins @ lvl 9, 30 mins @ lvl 7` or `Norwegian 4x4 - Treadmill Run - ...`:
   - No standard set pattern -- store the full line as `notes` on the exercise
   - Set `exercises: []` (no structured sets)
   - These are best-effort; the exercise name is extracted, and the rest goes to notes

8. **Unstructured lines**: Lines like `9 holes @ Hancock +13` or `Core Stability`:
   - Extract the text as the exercise name
   - No sets, reps, or weight
   - Store as-is

9. **Per-set variations**: Handle patterns like `Pendlay Row 2 x 8, 1 x 10 @ 105lbs`:
   - Parse as: 2 sets of 8 reps + 1 set of 10 reps, all at 105lbs
   - The comma-separated `N x M` groups before `@` each become their own set group

10. **Modifiers at end of line**: Text like `, 9 on 3rd set`, `last set 10`, `, N on last set`:
    - These override the rep count on the specified set
    - `9 on 3rd set` -> set 3 gets reps=9 instead of the default
    - `last set 10` or `last set N` -> last set gets reps=N

11. **Weight with "w/" prefix**: `w/ 8lb medicine ball` or `w/ 20lb KB`:
    - Parse the weight number from `(\d+)\s*lb`
    - Store the full descriptor (e.g., "8lb medicine ball") in notes

12. **`+ ExerciseName` suffix**: `Zercher Squats 2 x 5 @ 135lbs + Vertical Jumps`:
    - Parse the primary exercise normally
    - Add `"+ Vertical Jumps"` to the primary exercise's notes (do NOT create a separate exercise)

**`uniqueExerciseNames` extraction:**
- Collect all `exercise.name` values across all workouts
- Exclude exercises where `isSkipped: true`
- Exclude rest day workouts entirely
- Deduplicate (case-insensitive)
- Sort alphabetically

#### 2. Parser Tests
**File**: `packages/api/src/lib/workout-import-parser.test.ts` (new)

Cover these test cases:
- Standard exercise: `Zercher Squats 2 x 5 @ 135lbs` -> 2 sets, 5 reps, 135 weight
- Timed exercise: `Plank 3 x 60s` -> 3 sets, durationSeconds=60 each
- Bodyweight: `Dips 3 x 8 @ BW` -> 3 sets, 8 reps, weight=0
- RPE: `Zercher Squats 3 x 5 @ 165lbs rpe 9` -> rpe=9 on all sets
- Strikethrough: `~~Incline DB Y-Raise 2 x 12 @ 15lbs~~` -> isSkipped=true
- Rest days: `Rest Day`, `Rest/Skip`, `Skipped`, `Recovery focused`, `Mobility`
- EMOM: `30 KB Swings EMOM x 5 @ 40lbs` -> rounds=5, 5 sets of 30 reps @ 40lbs
- Sub-bullet as notes: `Assault Treadmill Sprints` + `* 10 sets, 15s @ 80%, 45s off`
- Sub-bullet as child exercise: `Core Stability` + `* Medicine Ball Russian Twist 3 x 50 @ 15lbs`
- Per-set override: `Incline Bench Press 3 x 8 @ 135lbs, 9 on 3rd set` -> set 3 has reps=9
- Per-set override: `Lat Pulldown 3 x 8 @ 137.5lbs rpe 9, last set 10` -> last set reps=10
- Multi-group sets: `Pendlay Row 2 x 8, 1 x 10 @ 105lbs` -> 3 total sets
- No-weight exercise: `Hamstring Stretch to Lunge Rock 3 x 10` -> 3 sets, 10 reps, no weight
- `w/` weight: `Russian Twist 3 x 60 w/ 8lb medicine ball` -> weight=8, notes="medicine ball"
- `+` suffix: `Zercher Squats 2 x 5 @ 135lbs + Vertical Jumps` -> notes contains "Vertical Jumps"
- Height notation: `Box Jumps 3 x 10 @ 24"` -> notes contains `24"`, weight undefined
- Cardio: `Stairmaster 5 mins @ lvl 9, 30 mins @ lvl 7` -> no sets, full line in notes
- Norwegian 4x4: full line -> exercise name extracted, details in notes
- Golf: `9 holes @ Hancock +13` -> exercise name, no sets
- `Dips Machine 3 x 8 @ 198lbs, 12 reps last set*` -> last set reps=12
- Parse warnings for genuinely unparseable lines
- Full file parse: feed the actual markdown file content and verify workout count, exercise count, date ordering
- `uniqueExerciseNames` is correct (deduplicated, excludes skipped, excludes rest days)
- Date boundary handling: the `**20260331**` line with trailing `** **` is parsed correctly

#### 3. Export from lib index
**File**: `packages/api/src/lib/index.ts`
**Changes**: Add re-export for the parser module

```typescript
export * from "./workout-import-parser";
```

### Success Criteria:

#### Automated Verification:
- [x] All parser tests pass: `cd packages/api && pnpm test -- workout-import-parser`
- [x] TypeScript compiles: `pnpm -r --filter @src/api exec tsc --noEmit`
- [x] Parsing the actual markdown file at `/Users/anthony/Downloads/2026 Athletic & Bodybuilding Plan/2026 Athletic & Bodybuilding Plan.md` produces the expected number of workouts (verify count in a test)

#### Manual Verification:
- [ ] Spot-check 5 random workout dates from the parsed output against the raw markdown

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the tests look correct before proceeding to the next phase.

---

## Phase 2: Fuzzy Exercise Matcher + tRPC Import Router

### Overview
Build the fuzzy matching logic and three tRPC procedures: `parse`, `resolveExercises`, and `commit`.

### Changes Required:

#### 1. Fuzzy Matcher Module
**File**: `packages/api/src/lib/fuzzy-match.ts` (new)

```typescript
export interface FuzzyMatchResult {
  exerciseId: string;
  exerciseName: string;
  score: number;         // 0-100, where 100 = exact match
  category: string;
  exerciseType: string;
}

export interface ExerciseResolution {
  parsedName: string;
  matches: FuzzyMatchResult[];      // top 5 matches, sorted by score descending
  bestMatch: FuzzyMatchResult | null; // highest score, or null if no match > 30%
  confidence: "high" | "low" | "none";
  // high = best match score >= 80
  // low  = best match score >= 50 and < 80
  // none = best match score < 50 or no matches
}

/**
 * Compute similarity score (0-100) between two exercise names.
 *
 * Strategy (combined scoring):
 * 1. Normalize both strings: lowercase, trim, remove punctuation, collapse whitespace
 * 2. Token overlap score (Jaccard): |intersection| / |union| of word tokens * 100
 * 3. Substring containment bonus: if one name contains the other, add 20 points (capped at 100)
 * 4. Levenshtein distance penalty: only applied to short names (< 3 tokens).
 *    score = max(0, 100 - (levenshtein / maxLen * 100))
 * 5. Final score = max(tokenScore + containmentBonus, levenshteinScore)
 *
 * This handles cases like:
 * - "Dips" vs "Dips Machine" (high overlap)
 * - "Lat Pulldown" vs "Lat Pull Down" (tokens match)
 * - "RDL" vs "Romanian Deadlift" (low score, needs manual mapping)
 */
export function computeSimilarity(a: string, b: string): number;

/**
 * Given a list of parsed exercise names and the full exercise library,
 * return resolution suggestions for each name.
 */
export function resolveExerciseNames(
  parsedNames: string[],
  exerciseLibrary: { id: string; name: string; category: string; exerciseType: string }[],
): ExerciseResolution[];
```

#### 2. Fuzzy Matcher Tests
**File**: `packages/api/src/lib/fuzzy-match.test.ts` (new)

Test cases:
- Exact match: "Lat Pulldown" vs "Lat Pulldown" -> score 100
- Case insensitive: "lat pulldown" vs "Lat Pulldown" -> score 100
- Close match: "Dips Machine" vs "Dip Machine" -> score >= 80
- Partial match: "Dips" vs "Dips Machine" -> score >= 50 (containment bonus)
- No match: "Zercher Squats" vs "Bench Press" -> score < 50
- Token overlap: "Incline Bench Press" vs "Incline Bench" -> score >= 70
- Abbreviation mismatch: "RDL" vs "Romanian Deadlift" -> score < 50 (expected -- requires manual mapping)
- Threshold classification: verify "high", "low", "none" buckets

#### 3. Import Router
**File**: `packages/api/src/routers/import.ts` (new)

```typescript
import { z } from "zod";
import { eq, and, gte, lte, or } from "drizzle-orm";
import { db } from "@src/db";
import { exercise, exerciseLog, exerciseSet, workout } from "@src/db/schema/index";
import { protectedProcedure, router } from "../index";
import { parseWorkoutMarkdown } from "../lib/workout-import-parser";
import { resolveExerciseNames } from "../lib/fuzzy-match";
import { calculateTotalVolume } from "../lib/workout-utils";
import { recalculateProgressiveOverload } from "../lib/progressive-overload-db";
import { recalculateMuscleGroupVolumeForWeek } from "../lib/muscle-group-volume-db";

export const importRouter = router({
  /**
   * Step 1: Parse markdown text into structured data.
   * Input: raw markdown string
   * Output: parsed workouts + unique exercise names + warnings
   */
  parse: protectedProcedure
    .input(z.object({
      markdown: z.string().min(1).max(500_000), // ~500KB limit
    }))
    .mutation(async ({ input }) => {
      const result = parseWorkoutMarkdown(input.markdown);
      return {
        workouts: result.workouts.map(w => ({
          date: w.date.toISOString(),
          exercises: w.exercises,
          isRestDay: w.isRestDay,
          rawText: w.rawText,
        })),
        uniqueExerciseNames: result.uniqueExerciseNames,
        parseWarnings: result.parseWarnings,
      };
    }),

  /**
   * Step 2: Fuzzy match parsed names against the exercise library.
   * Input: array of unique exercise names
   * Output: resolution suggestions per name
   */
  resolveExercises: protectedProcedure
    .input(z.object({
      exerciseNames: z.array(z.string().min(1)),
    }))
    .query(async ({ ctx, input }) => {
      // Fetch all exercises visible to this user (global + their custom)
      const allExercises = await db
        .select({
          id: exercise.id,
          name: exercise.name,
          category: exercise.category,
          exerciseType: exercise.exerciseType,
        })
        .from(exercise)
        .where(
          or(
            eq(exercise.isCustom, false),
            eq(exercise.createdByUserId, ctx.session.user.id),
          ),
        );

      return resolveExerciseNames(input.exerciseNames, allExercises);
    }),

  /**
   * Step 2b: Check for existing workouts on the same dates as the import.
   * Returns dates that already have workouts.
   */
  checkDuplicateDates: protectedProcedure
    .input(z.object({
      dates: z.array(z.string()), // ISO date strings
    }))
    .query(async ({ ctx, input }) => {
      const dates = input.dates.map(d => new Date(d));
      if (dates.length === 0) return [];

      const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
      const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

      // Expand range by 1 day on each side to account for timezone differences
      minDate.setDate(minDate.getDate() - 1);
      maxDate.setDate(maxDate.getDate() + 1);

      const existingWorkouts = await db
        .select({ date: workout.date })
        .from(workout)
        .where(
          and(
            eq(workout.userId, ctx.session.user.id),
            gte(workout.date, minDate),
            lte(workout.date, maxDate),
          ),
        );

      // Return ISO date strings of existing workouts
      return existingWorkouts.map(w => w.date.toISOString());
    }),

  /**
   * Step 3: Commit the import.
   * Input: parsed workouts + exercise resolution map
   * Output: { importedCount, skippedCount }
   *
   * Resolution map: parsedName -> { exerciseId } (existing) or { create: { name, category, exerciseType, ... } }
   */
  commit: protectedProcedure
    .input(z.object({
      workouts: z.array(z.object({
        date: z.string(), // ISO date string
        workoutType: z.enum([
          "weightlifting", "hiit", "cardio", "calisthenics", "yoga", "sports", "mixed",
        ]),
        notes: z.string().optional(),
        exercises: z.array(z.object({
          name: z.string(),
          sets: z.array(z.object({
            setNumber: z.number(),
            reps: z.number().optional(),
            weight: z.number().optional(),
            rpe: z.number().optional(),
            durationSeconds: z.number().optional(),
          })),
          notes: z.string().optional(),
          isSkipped: z.boolean(),
          rounds: z.number().optional(),
          workDurationSeconds: z.number().optional(),
          restDurationSeconds: z.number().optional(),
        })),
      })),
      resolutionMap: z.record(z.string(), z.union([
        // Mapped to existing exercise
        z.object({
          type: z.literal("existing"),
          exerciseId: z.string().uuid(),
        }),
        // Create new exercise during import
        z.object({
          type: z.literal("create"),
          name: z.string().min(1),
          category: z.enum([
            "chest", "back", "shoulders", "arms", "legs", "core", "cardio", "other",
          ]),
          exerciseType: z.enum([
            "weightlifting", "hiit", "cardio", "calisthenics", "yoga", "sports", "mixed",
          ]),
        }),
        // Skip this exercise (don't import it)
        z.object({
          type: z.literal("skip"),
        }),
      ])),
      skipDuplicateDates: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // --- Phase A: Create any new exercises (outside the main transaction for simplicity) ---
      const createdExerciseMap: Record<string, string> = {}; // parsedName -> new exerciseId
      for (const [parsedName, resolution] of Object.entries(input.resolutionMap)) {
        if (resolution.type === "create") {
          const id = crypto.randomUUID();
          await db.insert(exercise).values({
            id,
            name: resolution.name,
            category: resolution.category,
            exerciseType: resolution.exerciseType,
            isCustom: true,
            createdByUserId: userId,
            status: null, // auto-approved -- skip the review queue
          });
          createdExerciseMap[parsedName] = id;
        }
      }

      // --- Phase B: Build the exerciseId lookup ---
      const exerciseIdForName = (parsedName: string): string | null => {
        const resolution = input.resolutionMap[parsedName];
        if (!resolution || resolution.type === "skip") return null;
        if (resolution.type === "existing") return resolution.exerciseId;
        return createdExerciseMap[parsedName] ?? null;
      };

      // --- Phase C: Filter workouts ---
      let workoutsToImport = input.workouts.filter(w => {
        // Skip workouts where ALL exercises are skipped in resolutionMap
        const nonSkippedExercises = w.exercises.filter(ex => {
          if (ex.isSkipped) return false;
          const resolution = input.resolutionMap[ex.name];
          return resolution && resolution.type !== "skip";
        });
        return nonSkippedExercises.length > 0;
      });

      // Handle duplicate dates if requested
      if (input.skipDuplicateDates) {
        // Filter is handled client-side before sending -- but double-check
        // by querying existing dates
        const existingDates = new Set(
          (await db
            .select({ date: workout.date })
            .from(workout)
            .where(eq(workout.userId, userId)))
            .map(w => w.date.toISOString().slice(0, 10))
        );
        workoutsToImport = workoutsToImport.filter(w => {
          const dateKey = new Date(w.date).toISOString().slice(0, 10);
          return !existingDates.has(dateKey);
        });
      }

      // --- Phase D: Batch insert in a transaction ---
      let importedCount = 0;
      const allExerciseIds = new Set<string>();

      await db.transaction(async (tx) => {
        for (const w of workoutsToImport) {
          const workoutId = crypto.randomUUID();

          // Calculate total volume for this workout
          let totalVolume = 0;
          const nonSkippedExercises = w.exercises.filter(ex => {
            if (ex.isSkipped) return false;
            const resolution = input.resolutionMap[ex.name];
            return resolution && resolution.type !== "skip";
          });

          for (const ex of nonSkippedExercises) {
            for (const set of ex.sets) {
              if (set.durationSeconds !== undefined && set.reps === undefined) {
                totalVolume += set.durationSeconds;
              } else {
                totalVolume += (set.reps ?? 0) * (set.weight ?? 0);
              }
            }
          }

          await tx.insert(workout).values({
            id: workoutId,
            userId,
            date: new Date(w.date),
            workoutType: w.workoutType,
            notes: w.notes ?? null,
            totalVolume: totalVolume > 0 ? totalVolume : null,
          });

          for (let i = 0; i < nonSkippedExercises.length; i++) {
            const ex = nonSkippedExercises[i];
            const exId = exerciseIdForName(ex.name);
            if (exId) allExerciseIds.add(exId);

            const logId = crypto.randomUUID();
            await tx.insert(exerciseLog).values({
              id: logId,
              workoutId,
              exerciseId: exId,
              exerciseName: ex.name,
              order: i,
              rounds: ex.rounds ?? null,
              workDurationSeconds: ex.workDurationSeconds ?? null,
              restDurationSeconds: ex.restDurationSeconds ?? null,
              notes: ex.notes ?? null,
            });

            if (ex.sets.length > 0) {
              await tx.insert(exerciseSet).values(
                ex.sets.map(s => ({
                  id: crypto.randomUUID(),
                  exerciseLogId: logId,
                  setNumber: s.setNumber,
                  reps: s.reps ?? null,
                  weight: s.weight ?? null,
                  rpe: s.rpe ?? null,
                  durationSeconds: s.durationSeconds ?? null,
                })),
              );
            }
          }

          importedCount++;
        }
      });

      // --- Phase E: Fire-and-forget recalculations ---
      const exerciseIds = Array.from(allExerciseIds);
      if (exerciseIds.length > 0) {
        recalculateProgressiveOverload(userId, exerciseIds).catch(
          err => console.error("Import: progressive overload recalc failed:", err),
        );
      }
      // Recalculate muscle group volume for each unique week
      const uniqueWeeks = new Set(
        workoutsToImport.map(w => {
          const d = new Date(w.date);
          // Get Monday of the week
          const day = d.getDay();
          const diff = d.getDate() - day + (day === 0 ? -6 : 1);
          return new Date(d.getFullYear(), d.getMonth(), diff).toISOString().slice(0, 10);
        }),
      );
      for (const weekStart of uniqueWeeks) {
        recalculateMuscleGroupVolumeForWeek(userId, new Date(weekStart)).catch(
          err => console.error("Import: muscle group volume recalc failed:", err),
        );
      }

      return {
        importedCount,
        skippedCount: input.workouts.length - importedCount,
        createdExerciseCount: Object.keys(createdExerciseMap).length,
      };
    }),
});
```

#### 4. Register Import Router
**File**: `packages/api/src/routers/index.ts`
**Changes**: Add the import router

```typescript
import { importRouter } from "./import";

// In the router definition:
export const appRouter = router({
  // ... existing routes ...
  import: importRouter,
});
```

### Success Criteria:

#### Automated Verification:
- [x] Fuzzy match tests pass: `cd packages/api && pnpm test -- fuzzy-match`
- [x] TypeScript compiles: `pnpm -r --filter @src/api exec tsc --noEmit`
- [x] Existing tests still pass: `cd packages/api && pnpm test`

#### Manual Verification:
- [ ] N/A for this phase -- the router will be tested via the UI in Phase 3

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Web UI Import Wizard

### Overview
Build a 4-step wizard at `/import` on the web app: Upload -> Exercise Resolution -> Preview -> Confirm.

### Changes Required:

#### 1. Import Route File
**File**: `apps/web/src/routes/import.tsx` (new)

The route uses TanStack Router file-based routing (same pattern as `workouts/new.tsx`).

```typescript
import { createFileRoute, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/import")({
  component: ImportPage,
  beforeLoad: async ({ context }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
    const isComplete = await context.queryClient.fetchQuery(
      context.trpc.preferences.isOnboardingComplete.queryOptions(),
    );
    if (!isComplete) {
      redirect({ to: "/onboarding", throw: true });
    }
    return { session };
  },
});
```

The `ImportPage` component manages wizard state with `useState`:

```typescript
type WizardStep = "upload" | "resolve" | "preview" | "complete";

function ImportPage() {
  const [step, setStep] = useState<WizardStep>("upload");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [resolutions, setResolutions] = useState<ExerciseResolution[] | null>(null);
  const [resolutionMap, setResolutionMap] = useState<Record<string, Resolution>>({});
  const [duplicateDates, setDuplicateDates] = useState<string[]>([]);
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  // Render the current step component
}
```

#### 2. Step 1: Upload Component
**File**: `apps/web/src/components/import/upload-step.tsx` (new)

- Large drop zone area with dashed border
- Accepts `.md` files only
- On file drop/select, read file as text using `FileReader`
- Call `import.parse` mutation with the text
- Show loading state during parse
- On success, display summary: `N workouts found, N rest days, N unique exercises`
- Show parse warnings if any (expandable section)
- "Next" button to proceed to resolution step

#### 3. Step 2: Exercise Resolution Component
**File**: `apps/web/src/components/import/resolution-step.tsx` (new)

Calls `import.resolveExercises` query with the unique exercise names.

Displays exercises in 3 collapsible sections (buckets):

**a. High Confidence Matches (>= 80%)**
- Shows: `[parsed name] -> [matched exercise name] (score%)`
- Auto-selected, but user can click to change
- Badge: green checkmark

**b. Low Confidence Matches (50-79%)**
- Shows: `[parsed name] -> [top suggestion] (score%)?`
- User must confirm or pick different match from dropdown
- Dropdown shows top 5 suggestions + "Create New" option
- Badge: yellow warning

**c. No Match (< 50%)**
- Shows: `[parsed name] -> ???`
- User must either:
  - Search and select from exercise library (inline search input)
  - Click "Create New" which opens an inline form with:
    - Name (pre-filled with parsed name)
    - Category (dropdown)
    - Exercise Type (dropdown)
- Badge: red X

**"Create New" inline form:**
- Pre-fills name from parsed name
- Category dropdown (chest, back, shoulders, arms, legs, core, cardio, other)
- Exercise type dropdown (weightlifting, hiit, cardio, calisthenics, yoga, sports, mixed)
- These exercises are auto-approved (status=null, skip review queue)

**Bottom bar:**
- Progress indicator: `N of M exercises resolved`
- "Next" button -- disabled until all exercises have a resolution (either mapped, created, or explicitly skipped)
- "Skip" option per exercise -- marks it as intentionally excluded from import

Also triggers `import.checkDuplicateDates` in parallel to detect existing workouts on the same dates.

#### 4. Step 3: Preview Component
**File**: `apps/web/src/components/import/preview-step.tsx` (new)

- Shows paginated list of workouts to be imported (10 per page)
- Each workout card shows:
  - Date (formatted)
  - Workout type badge
  - List of exercises with resolved names
  - Set details (reps x weight, or duration)
  - Any notes
  - Highlight if this date has a duplicate (yellow warning with option to skip)
- Summary stats at top: `N workouts, N exercises total, N new exercises to create`
- Duplicate date handling:
  - If duplicates found, show warning banner: "N workout dates already exist in your log"
  - Toggle: "Skip duplicates" (default on) / "Import anyway (creates duplicates)"
- "Import" button to commit
- "Back" button to go back to resolution

#### 5. Step 4: Complete Component
**File**: `apps/web/src/components/import/complete-step.tsx` (new)

- Success message with confetti or checkmark icon
- Summary: `Imported N workouts, created N new exercises, skipped N duplicates`
- Links: "View Workouts" (-> `/workouts`), "Import Another" (reset wizard)

#### 6. Workout Type Inference
The parser produces exercise-level data but doesn't assign a `workoutType` to each workout. Add a helper:

**File**: `packages/api/src/lib/workout-import-parser.ts` (addition)

```typescript
/**
 * Infer workout type from the exercises in a workout.
 *
 * Rules:
 * - If ALL exercises are timed (durationSeconds only, no reps): "calisthenics"
 * - If any exercise has EMOM/rounds: "hiit"
 * - If any exercise name contains cardio keywords (treadmill, stairmaster, sprint): "cardio"
 * - If any exercise has reps + weight: "weightlifting"
 * - If mix of types: "mixed"
 * - Default: "weightlifting"
 */
export function inferWorkoutType(exercises: ParsedExercise[]): WorkoutType;
```

#### 7. Navigation Link
**File**: `apps/web/src/components/header.tsx`
**Changes**: Add "Import" link to the navigation (next to existing links). Only show when logged in.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `pnpm -r --filter web exec tsc --noEmit`
- [ ] No lint errors: `pnpm -r --filter web exec eslint .`
- [x] API tests still pass: `cd packages/api && pnpm test`

#### Manual Verification:
- [ ] Navigate to `/import` while logged in -- page renders
- [ ] Upload the actual markdown file -- parsing succeeds and shows correct summary
- [ ] Exercise resolution step shows exercises in the correct buckets
- [ ] Can resolve all exercises (map, create new, or skip)
- [ ] Preview step shows correct workout data
- [ ] Duplicate date detection works if any workouts already exist for those dates
- [ ] Commit succeeds -- workouts appear on `/workouts` page
- [ ] New exercises created during import show up in exercise library (without "pending" status)
- [ ] Progressive overload recalculation fires (check console for errors)
- [ ] Import the full file end-to-end and spot-check 5 workouts against the source

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the full import flow works correctly end-to-end.

---

## Phase 4: Polish and Edge Cases

### Overview
Handle remaining edge cases, improve UX, and add error recovery.

### Changes Required:

#### 1. Error Handling in Commit
**File**: `packages/api/src/routers/import.ts`
**Changes**:
- Wrap the transaction in try/catch
- On failure, return a clear error message indicating which workout/exercise failed
- The transaction rollback is automatic (Drizzle handles this)

#### 2. Large File Handling
**File**: `apps/web/src/components/import/upload-step.tsx`
**Changes**:
- Show file size warning if > 200KB
- Show progress indicator during parse (the mutation's `isPending` state)
- Disable "Next" while parsing

#### 3. Re-import Protection
**File**: `apps/web/src/components/import/preview-step.tsx`
**Changes**:
- After successful import, disable the "Import" button permanently (prevent double-click)
- Show the commit mutation's loading state on the button

#### 4. Workout Type Override in Preview
**File**: `apps/web/src/components/import/preview-step.tsx`
**Changes**:
- Allow user to override the inferred workout type per workout in the preview step
- Dropdown on each workout card

### Success Criteria:

#### Automated Verification:
- [x] All tests pass: `cd packages/api && pnpm test`
- [x] TypeScript compiles: `pnpm -r exec tsc --noEmit`

#### Manual Verification:
- [ ] Import the full markdown file end-to-end
- [ ] Verify all workouts appear correctly on the workouts list page
- [ ] Verify the calendar view shows workout days correctly
- [ ] Try importing the same file again -- duplicate warning appears
- [ ] Error recovery: if network fails mid-import, no partial data is committed (transaction rollback)

---

## Testing Strategy

### Unit Tests:
- **Parser**: All format patterns, edge cases, malformed input, empty file
- **Fuzzy matcher**: Score accuracy, threshold boundaries, performance with ~200 exercises in library
- Both in `packages/api/src/lib/` using vitest (existing test framework)

### Integration Tests:
- None for now -- the tRPC procedures would need a test DB setup which is out of scope
- The manual testing covers the integration path

### Manual Testing Steps:
1. Upload the actual markdown file at `/Users/anthony/Downloads/2026 Athletic & Bodybuilding Plan/2026 Athletic & Bodybuilding Plan.md`
2. Verify the parser finds the correct number of workout days vs rest days
3. Resolve all exercises through the wizard
4. Preview and confirm the import
5. Check 5 random workouts on the workouts page against the source file
6. Verify the calendar page shows the correct dates highlighted
7. Try re-importing -- confirm duplicate date warning appears

## Performance Considerations

- **Parser**: The markdown file is ~400 lines -- parsing is instant. No optimization needed.
- **Fuzzy matching**: With ~200 exercises in the library and ~50 unique parsed names, this is O(n*m) = ~10,000 comparisons. Each comparison is O(len) string ops. Should complete in < 100ms.
- **Commit transaction**: Inserting ~40 workouts with ~150 exercise logs and ~500 sets in a single transaction. Should complete in < 5 seconds on a standard Postgres instance.
- **Progressive overload recalc**: Runs async (fire-and-forget). May take 10-30 seconds for ~40 workouts. No impact on user-facing response time.

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Fuzzy match threshold | 80% for auto-map, 50% for suggestions | 80% captures obvious matches (case/whitespace differences) without false positives. 50% catches partial name matches. |
| EMOM mapping | `rounds` on exerciseLog + individual sets | Matches existing schema fields. Each round becomes a set with the per-round rep/weight. |
| Cardio-only exercises | Store in notes, no structured sets | The markdown format is too varied for cardio (different machines, intervals, etc.). Better to preserve the raw text. |
| totalVolume | Computed during commit from set data | Same formula as `calculateSetVolume` in `workout-utils.ts`. Duration-only exercises contribute their seconds as volume (existing pattern). |
| Duplicate date handling | Warn + toggle to skip | Non-destructive -- never overwrites. User can choose to have two workouts on the same date if desired. |
| File upload strategy | Send raw text via tRPC mutation (not multipart) | The file is small (~50KB). No need for file upload infrastructure. tRPC mutation with a 500KB string limit is sufficient. |
| New exercises from import | `status: null` (auto-approved) | These are the user's own exercises. Putting them in the review queue would be friction with no benefit. |
| Workout type inference | Auto-inferred from exercise types, overridable in preview | Reasonable defaults with user control. |

## File Summary

### New Files:
- `packages/api/src/lib/workout-import-parser.ts` -- parser (pure function)
- `packages/api/src/lib/workout-import-parser.test.ts` -- parser tests
- `packages/api/src/lib/fuzzy-match.ts` -- fuzzy matching logic
- `packages/api/src/lib/fuzzy-match.test.ts` -- fuzzy match tests
- `packages/api/src/routers/import.ts` -- tRPC import router
- `apps/web/src/routes/import.tsx` -- import page route
- `apps/web/src/components/import/upload-step.tsx` -- step 1 UI
- `apps/web/src/components/import/resolution-step.tsx` -- step 2 UI
- `apps/web/src/components/import/preview-step.tsx` -- step 3 UI
- `apps/web/src/components/import/complete-step.tsx` -- step 4 UI

### Modified Files:
- `packages/api/src/routers/index.ts` -- register import router
- `packages/api/src/lib/index.ts` -- re-export parser types
- `apps/web/src/components/header.tsx` -- add Import nav link

## References

- Existing workout create pattern: `packages/api/src/routers/workouts.ts:187-265`
- Workout form utilities: `packages/api/src/lib/workout-utils.ts`
- Exercise schema: `packages/db/src/schema/exercise.ts`
- Progressive overload recalc: `packages/api/src/lib/progressive-overload-db.ts`
- Source markdown file: `/Users/anthony/Downloads/2026 Athletic & Bodybuilding Plan/2026 Athletic & Bodybuilding Plan.md`
