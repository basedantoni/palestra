/**
 * Shared Whoop workout upsert — the single source of truth for the three-path
 * dedup logic that imports a Whoop activity into a workout + exercise log.
 *
 * Previously this logic was duplicated (~130 lines each) inside
 * `workoutProcessor` (whoop-webhook.ts) and `triggerBackfill` (whoop-backfill.ts).
 * Both now delegate here.
 *
 * Three paths, keyed on whether a workout already exists for
 * (userId, whoopActivityId):
 *   - manual-link  (existing workout, source != "whoop"): update the linked
 *     exercise log's metrics only; leave the workout row untouched.
 *   - auto-update  (existing workout, source == "whoop"): update the workout's
 *     date/type and its exercise log's metrics.
 *   - new-import   (no existing workout): create a workout + exercise log.
 *
 * After every log insert/update, running PRs are recorded via `recordRunningPrs`.
 * `lastImportedAt` is bumped inside the same transaction.
 *
 * Callers remain responsible for: the auto-import gate, the PENDING_SCORE skip,
 * notification emission, and fire-and-forget recalculations.
 */

import { and, eq } from "drizzle-orm";

import { db } from "@src/db";
import { exerciseLog, whoopConnection, workout } from "@src/db/schema/index";
import { whoopSportToWorkoutType } from "@src/shared";

import {
  whoopActivityToExerciseLog,
  type WhoopActivityDetail,
} from "./whoop-activity-dto";
import { recordRunningPrs } from "./personal-records";
import { resolveWhoopExerciseId } from "./whoop-client";

export type UpsertWhoopResult =
  | { path: "manual-link"; workoutId: string }
  | { path: "auto-update"; workoutId: string }
  | { path: "new-import"; workoutId: string };

/**
 * Imports a single Whoop activity into the user's workout history using the
 * three-path dedup strategy. Returns which path executed and the affected
 * workout ID. Throws on DB/transaction failure — callers decide how to surface
 * errors (mark event failed, log + continue, etc.).
 */
export async function upsertWhoopWorkout(
  userId: string,
  activity: WhoopActivityDetail,
): Promise<UpsertWhoopResult> {
  const whoopActivityId = activity.id;

  // Does a workout already exist for this (userId, whoopActivityId)?
  const [existingWorkout] = await db
    .select({
      id: workout.id,
      source: workout.source,
      date: workout.date,
      workoutType: workout.workoutType,
    })
    .from(workout)
    .where(
      and(
        eq(workout.userId, userId),
        eq(workout.whoopActivityId, whoopActivityId),
      ),
    )
    .limit(1);

  // Shared derived values used by all three paths.
  const patch = whoopActivityToExerciseLog(activity);
  const workoutDate = new Date(activity.start);
  const workoutType = whoopSportToWorkoutType(
    activity.sport_id,
    activity.sport_name,
  );
  const resolvedExercise = await resolveWhoopExerciseId(
    activity.sport_id,
    activity.sport_name,
    patch.distanceMeter,
  );

  if (existingWorkout) {
    if (existingWorkout.source !== "whoop") {
      // Path 1 — Manual link: update exercise log metrics only, workout untouched.
      await db.transaction(async (tx) => {
        const [firstLog] = await tx
          .select({ id: exerciseLog.id, exerciseId: exerciseLog.exerciseId })
          .from(exerciseLog)
          .where(eq(exerciseLog.workoutId, existingWorkout.id))
          .limit(1);

        if (firstLog) {
          await tx
            .update(exerciseLog)
            .set({
              heartRate: patch.heartRate,
              intensity: patch.intensity,
              distanceMeter: patch.distanceMeter,
              durationMinutes: patch.durationMinutes,
              hrZoneDurations: patch.hrZoneDurations,
            })
            .where(eq(exerciseLog.id, firstLog.id));

          await recordRunningPrs(tx, {
            userId,
            exerciseId: firstLog.exerciseId,
            workoutId: existingWorkout.id,
            dateAchieved: existingWorkout.date,
            distanceMeter: patch.distanceMeter,
            durationMinutes: patch.durationMinutes,
          });
        }

        await tx
          .update(whoopConnection)
          .set({ lastImportedAt: new Date() })
          .where(eq(whoopConnection.userId, userId));
      });

      return { path: "manual-link", workoutId: existingWorkout.id };
    }

    // Path 2 — Auto-imported update: update workout date/type + exercise log metrics.
    await db.transaction(async (tx) => {
      await tx
        .update(workout)
        .set({ date: workoutDate, workoutType })
        .where(eq(workout.id, existingWorkout.id));

      const [firstLog] = await tx
        .select({ id: exerciseLog.id })
        .from(exerciseLog)
        .where(eq(exerciseLog.workoutId, existingWorkout.id))
        .limit(1);

      if (firstLog) {
        await tx
          .update(exerciseLog)
          .set({
            ...(resolvedExercise ? { exerciseId: resolvedExercise.id } : {}),
            heartRate: patch.heartRate,
            intensity: patch.intensity,
            distanceMeter: patch.distanceMeter,
            durationMinutes: patch.durationMinutes,
            hrZoneDurations: patch.hrZoneDurations,
          })
          .where(eq(exerciseLog.id, firstLog.id));

        await recordRunningPrs(tx, {
          userId,
          exerciseId: resolvedExercise?.id ?? null,
          workoutId: existingWorkout.id,
          dateAchieved: workoutDate,
          distanceMeter: patch.distanceMeter,
          durationMinutes: patch.durationMinutes,
        });
      }

      await tx
        .update(whoopConnection)
        .set({ lastImportedAt: new Date() })
        .where(eq(whoopConnection.userId, userId));
    });

    return { path: "auto-update", workoutId: existingWorkout.id };
  }

  // Path 3 — New import: create workout + exercise log.
  const newWorkoutId = crypto.randomUUID();
  const newLogId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(workout).values({
      id: newWorkoutId,
      userId,
      date: workoutDate,
      workoutType,
      durationMinutes: patch.durationMinutes ?? undefined,
      source: "whoop",
      whoopActivityId,
    });

    await tx.insert(exerciseLog).values({
      id: newLogId,
      workoutId: newWorkoutId,
      exerciseId: resolvedExercise?.id ?? undefined,
      exerciseName: resolvedExercise?.name ?? activity.sport_name,
      order: 0,
      heartRate: patch.heartRate,
      intensity: patch.intensity,
      distanceMeter: patch.distanceMeter,
      durationMinutes: patch.durationMinutes,
      hrZoneDurations: patch.hrZoneDurations,
    });

    await recordRunningPrs(tx, {
      userId,
      exerciseId: resolvedExercise?.id ?? null,
      workoutId: newWorkoutId,
      dateAchieved: workoutDate,
      distanceMeter: patch.distanceMeter,
      durationMinutes: patch.durationMinutes,
    });

    await tx
      .update(whoopConnection)
      .set({ lastImportedAt: new Date() })
      .where(eq(whoopConnection.userId, userId));
  });

  return { path: "new-import", workoutId: newWorkoutId };
}
