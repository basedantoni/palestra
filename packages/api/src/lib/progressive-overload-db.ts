import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@src/db";
import {
  exercise,
  exerciseLog,
  exerciseSet,
  progressiveOverloadState,
  userPreferences,
  workout,
} from "@src/db/schema/index";

import {
  analyzeProgressiveOverload,
  buildSessionSnapshot,
  type ExerciseSessionSnapshot,
} from "./progressive-overload";

/**
 * Recalculate progressive overload state for specific exercises after a workout save.
 *
 * Designed to be called fire-and-forget after the workout transaction commits.
 * Errors are propagated to the caller for logging.
 *
 * @param userId - The user who saved the workout
 * @param exerciseIds - The exercise IDs from the saved workout to recalculate
 */
export async function recalculateProgressiveOverload(
  userId: string,
  exerciseIds: string[],
): Promise<void> {
  const uniqueExerciseIds = Array.from(new Set(exerciseIds));

  // 1. Fetch user preferences (plateauThreshold, weightUnit)
  const prefs = await db
    .select({
      plateauThreshold: userPreferences.plateauThreshold,
      weightUnit: userPreferences.weightUnit,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  // Use sensible defaults if the user has no preferences row yet
  const plateauThreshold = prefs[0]?.plateauThreshold ?? 3;
  const weightUnit: "lbs" | "kg" = prefs[0]?.weightUnit ?? "lbs";

  // 2. Process each exerciseId
  for (const exerciseId of uniqueExerciseIds) {
    // a. Look up the exercise and check its type
    const [exerciseRow] = await db
      .select({ exerciseType: exercise.exerciseType })
      .from(exercise)
      .where(eq(exercise.id, exerciseId))
      .limit(1);

    if (!exerciseRow) {
      // Exercise not found in catalog — skip
      continue;
    }

    const { exerciseType } = exerciseRow;
    if (exerciseType !== "weightlifting" && exerciseType !== "calisthenics") {
      // Only track progressive overload for weightlifting and calisthenics
      continue;
    }

    // b. Query the last 10 workout sessions containing this exercise for this user.
    //    Step 1: get the last 10 exercise log entries (one per workout session) for this
    //    exercise and user, ordered by workout date descending.
    const recentWorkoutLogs = await db
      .select({
        workoutId: workout.id,
        workoutDate: workout.date,
        exerciseLogId: exerciseLog.id,
      })
      .from(workout)
      .innerJoin(exerciseLog, eq(exerciseLog.workoutId, workout.id))
      .where(
        and(
          eq(workout.userId, userId),
          eq(exerciseLog.exerciseId, exerciseId),
        ),
      )
      .orderBy(desc(workout.date))
      .limit(10);

    if (recentWorkoutLogs.length === 0) {
      continue;
    }

    // Step 2: fetch all sets for those exercise log IDs in one query
    const exerciseLogIds = recentWorkoutLogs.map((r) => r.exerciseLogId);

    const allSets = await db
      .select({
        exerciseLogId: exerciseSet.exerciseLogId,
        reps: exerciseSet.reps,
        weight: exerciseSet.weight,
        rpe: exerciseSet.rpe,
        durationSeconds: exerciseSet.durationSeconds,
      })
      .from(exerciseSet)
      .where(inArray(exerciseSet.exerciseLogId, exerciseLogIds));

    // c. Group sets by exerciseLogId, then build snapshots oldest-first.
    //    recentWorkoutLogs is newest-first, so we reverse it before building.
    const setsByLogId = new Map<
      string,
      Array<{ reps: number | null; weight: number | null; rpe: number | null; durationSeconds: number | null }>
    >();
    for (const set of allSets) {
      const existing = setsByLogId.get(set.exerciseLogId);
      if (existing) {
        existing.push({ reps: set.reps, weight: set.weight, rpe: set.rpe, durationSeconds: set.durationSeconds });
      } else {
        setsByLogId.set(set.exerciseLogId, [
          { reps: set.reps, weight: set.weight, rpe: set.rpe, durationSeconds: set.durationSeconds },
        ]);
      }
    }

    const snapshots: ExerciseSessionSnapshot[] = [];
    for (const logEntry of [...recentWorkoutLogs].reverse()) {
      const sets = setsByLogId.get(logEntry.exerciseLogId) ?? [];
      snapshots.push(buildSessionSnapshot(logEntry.workoutDate, sets));
    }

    // d. Call the pure analysis function
    const analysis = analyzeProgressiveOverload(snapshots, {
      plateauThreshold,
      weightUnit,
    });

    // e. Atomic upsert by (userId, exerciseId) to avoid duplicate rows on concurrent writers.
    const now = new Date();
    await db
      .insert(progressiveOverloadState)
      .values({
        id: crypto.randomUUID(),
        userId,
        exerciseId,
        trendStatus: analysis.trendStatus,
        plateauCount: analysis.plateauCount,
        nextSuggestedProgression: analysis.suggestion,
        lastCalculatedAt: now,
        last10Workouts: snapshots,
      })
      .onConflictDoUpdate({
        target: [
          progressiveOverloadState.userId,
          progressiveOverloadState.exerciseId,
        ],
        set: {
          trendStatus: analysis.trendStatus,
          plateauCount: analysis.plateauCount,
          nextSuggestedProgression: analysis.suggestion,
          lastCalculatedAt: now,
          last10Workouts: snapshots,
        },
      });
  }
}
