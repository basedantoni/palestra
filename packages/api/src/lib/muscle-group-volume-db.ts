import { and, eq, gte, lte, sql } from "drizzle-orm";
import { startOfISOWeek, endOfISOWeek } from "date-fns";

import { db } from "@src/db";
import {
  exercise,
  exerciseLog,
  exerciseSet,
  muscleGroupVolume,
  workout,
} from "@src/db/schema/index";

/**
 * Recomputes muscle group volume totals for the ISO week containing `weekOf`.
 *
 * Designed to be called fire-and-forget after a workout is created or updated.
 * Deletes existing rows for the affected week and reinserts from scratch so
 * edits and deletions are always reflected correctly.
 */
export async function recalculateMuscleGroupVolumeForWeek(
  userId: string,
  weekOf: Date,
): Promise<void> {
  const weekStart = startOfISOWeek(weekOf);
  const weekEnd = endOfISOWeek(weekOf);

  // Format as "yyyy-MM-dd" for the date column
  const weekStartStr = weekStart.toISOString().split("T")[0]!;

  // Fetch all sets for workouts this user performed in this week,
  // joined to exercise muscle group tags.
  const rows = await db
    .select({
      workoutId: workout.id,
      muscleGroupsBodybuilding: exercise.muscleGroupsBodybuilding,
      muscleGroupsMovement: exercise.muscleGroupsMovement,
      reps: exerciseSet.reps,
      weight: exerciseSet.weight,
    })
    .from(workout)
    .innerJoin(exerciseLog, eq(exerciseLog.workoutId, workout.id))
    .leftJoin(exercise, eq(exercise.id, exerciseLog.exerciseId))
    .leftJoin(exerciseSet, eq(exerciseSet.exerciseLogId, exerciseLog.id))
    .where(
      and(
        eq(workout.userId, userId),
        gte(workout.date, weekStart),
        lte(workout.date, weekEnd),
      ),
    );

  // Accumulate volume per muscle group.
  // For weighted sets: volume = reps × weight.
  // For bodyweight sets (no weight): volume = reps (i.e. weight = 1).
  type Accumulator = { volume: number; workoutIds: Set<string> };

  const bodybuilding = new Map<string, Accumulator>();
  const movement = new Map<string, Accumulator>();

  for (const row of rows) {
    const setVolume = (row.reps ?? 0) * (row.weight ?? 1);

    for (const mg of row.muscleGroupsBodybuilding ?? []) {
      const acc = bodybuilding.get(mg) ?? { volume: 0, workoutIds: new Set() };
      acc.volume += setVolume;
      acc.workoutIds.add(row.workoutId);
      bodybuilding.set(mg, acc);
    }

    for (const mg of row.muscleGroupsMovement ?? []) {
      const acc = movement.get(mg) ?? { volume: 0, workoutIds: new Set() };
      acc.volume += setVolume;
      acc.workoutIds.add(row.workoutId);
      movement.set(mg, acc);
    }
  }

  // Delete stale rows for this week then reinsert.
  await db
    .delete(muscleGroupVolume)
    .where(
      and(
        eq(muscleGroupVolume.userId, userId),
        sql`${muscleGroupVolume.weekStartDate} = ${weekStartStr}`,
      ),
    );

  const insertRows: (typeof muscleGroupVolume.$inferInsert)[] = [];

  for (const [mg, acc] of bodybuilding) {
    insertRows.push({
      id: crypto.randomUUID(),
      userId,
      muscleGroup: mg as "chest" | "back" | "shoulders" | "arms" | "legs" | "core",
      categorizationSystem: "bodybuilding",
      weekStartDate: weekStartStr,
      totalVolume: acc.volume,
      workoutCount: acc.workoutIds.size,
    });
  }

  for (const [mg, acc] of movement) {
    insertRows.push({
      id: crypto.randomUUID(),
      userId,
      muscleGroup: mg as "push" | "pull" | "squat" | "hinge" | "carry",
      categorizationSystem: "movement_patterns",
      weekStartDate: weekStartStr,
      totalVolume: acc.volume,
      workoutCount: acc.workoutIds.size,
    });
  }

  if (insertRows.length > 0) {
    await db.insert(muscleGroupVolume).values(insertRows);
  }
}
