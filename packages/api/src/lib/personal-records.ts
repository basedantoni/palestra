/**
 * Personal-records helpers
 *
 * Reusable PR-recording logic, transaction-scoped so callers can compose it
 * inside their own `db.transaction(...)` block. Currently records running PRs
 * (longest_distance) for cardio/running exercise logs.
 *
 * A `best_pace` PR is intentionally NOT written: pace is derived at read time
 * from distance + duration (see analytics-queries / pr-formatters), so the
 * canonical stored running PR is `longest_distance` only.
 */

import { and, eq } from "drizzle-orm";

import { personalRecord } from "@src/db/schema/index";
import type { db } from "@src/db";

/** A transaction handle compatible with `db.transaction(async (tx) => ...)`. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface RecordRunningPrsArgs {
  userId: string;
  /** The exercise the log belongs to. PRs are only recorded when present. */
  exerciseId: string | null | undefined;
  /** The workout the PR is attributed to. */
  workoutId: string;
  /** When the PR was achieved (the workout date). */
  dateAchieved: Date;
  /** Distance for this log, in meters. Drives `longest_distance`. */
  distanceMeter: number | null | undefined;
  /** Duration for this log, in minutes. Reserved for future pace-based PRs. */
  durationMinutes?: number | null | undefined;
}

/**
 * Records running personal records for a single exercise log, inside the given
 * transaction. Idempotent against the stored best: only inserts a new PR row
 * when the candidate value strictly beats the existing best for the exercise.
 *
 * Reads the current best via `tx.select` (so test mocks must stub `tx.select`).
 * Safe to call after any cardio log insert OR update.
 */
export async function recordRunningPrs(
  tx: Tx,
  args: RecordRunningPrsArgs,
): Promise<void> {
  const { userId, exerciseId, workoutId, dateAchieved, distanceMeter } = args;

  // No exercise → cannot attribute a PR.
  if (!exerciseId) return;

  // longest_distance — higher is better.
  if (distanceMeter != null && distanceMeter > 0) {
    const [existing] = await tx
      .select({ value: personalRecord.value })
      .from(personalRecord)
      .where(
        and(
          eq(personalRecord.userId, userId),
          eq(personalRecord.exerciseId, exerciseId),
          eq(personalRecord.recordType, "longest_distance"),
        ),
      )
      .limit(1);

    const currentBest = existing?.value ?? null;
    if (currentBest == null || distanceMeter > currentBest) {
      await tx.insert(personalRecord).values({
        id: crypto.randomUUID(),
        userId,
        exerciseId,
        recordType: "longest_distance",
        value: distanceMeter,
        dateAchieved,
        workoutId,
        previousRecordValue: currentBest,
      });
    }
  }
}
