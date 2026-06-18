import { and, asc, desc, eq, isNull, ne, or } from "drizzle-orm";

import type { db } from "@life-tracker/db";
import { personalRecord, recordTypeEnum } from "@life-tracker/db/schema/index";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type RecordType = (typeof recordTypeEnum.enumValues)[number];

export type RecordPrArgs = {
  userId: string;
  exerciseId: string;
  recordType: RecordType;
  candidate: number | null | undefined;
  workoutId: string;
  dateAchieved: Date;
};

export type RunningPrArgs = {
  userId: string;
  exerciseId: string;
  workoutId: string;
  dateAchieved: Date;
  distanceMeter: number | null | undefined;
  durationMinutes: number | null | undefined;
};

export type RunningPrResults = {
  longestDistance: boolean;
  bestPace: boolean;
};

export type StrengthSetInput = {
  reps?: number | null;
  weight?: number | null;
};

export type StrengthPrArgs = {
  userId: string;
  exerciseId: string;
  workoutId: string;
  dateAchieved: Date;
  sets: StrengthSetInput[];
};

export type StrengthPrResults = {
  maxWeight: boolean;
  maxReps: boolean;
  maxVolume: boolean;
};

function isLowerBetter(recordType: RecordType): boolean {
  return recordType === "best_pace";
}

function beatsPriorBest(
  recordType: RecordType,
  candidate: number | null | undefined,
  priorBest: number | null | undefined,
): candidate is number {
  if (candidate == null) return false;
  if (priorBest == null) return true;
  return isLowerBetter(recordType)
    ? candidate < priorBest
    : candidate > priorBest;
}

export async function recordPr(tx: Tx, args: RecordPrArgs): Promise<boolean> {
  const [existingForWorkout] = await tx
    .select({
      id: personalRecord.id,
    })
    .from(personalRecord)
    .where(
      and(
        eq(personalRecord.userId, args.userId),
        eq(personalRecord.exerciseId, args.exerciseId),
        eq(personalRecord.recordType, args.recordType),
        eq(personalRecord.workoutId, args.workoutId),
      ),
    )
    .limit(1);

  const [priorBest] = await tx
    .select({
      value: personalRecord.value,
    })
    .from(personalRecord)
    .where(
      and(
        eq(personalRecord.userId, args.userId),
        eq(personalRecord.exerciseId, args.exerciseId),
        eq(personalRecord.recordType, args.recordType),
        or(
          isNull(personalRecord.workoutId),
          ne(personalRecord.workoutId, args.workoutId),
        ),
      ),
    )
    .orderBy(
      isLowerBetter(args.recordType)
        ? asc(personalRecord.value)
        : desc(personalRecord.value),
    )
    .limit(1);

  const priorBestValue = priorBest?.value ?? null;

  if (!beatsPriorBest(args.recordType, args.candidate, priorBestValue)) {
    if (existingForWorkout) {
      await tx
        .delete(personalRecord)
        .where(eq(personalRecord.id, existingForWorkout.id));
    }

    return false;
  }

  const values = {
    userId: args.userId,
    exerciseId: args.exerciseId,
    recordType: args.recordType,
    value: args.candidate,
    dateAchieved: args.dateAchieved,
    workoutId: args.workoutId,
    previousRecordValue: priorBestValue,
  };

  if (existingForWorkout) {
    await tx
      .update(personalRecord)
      .set(values)
      .where(eq(personalRecord.id, existingForWorkout.id));
  } else {
    await tx.insert(personalRecord).values({
      id: crypto.randomUUID(),
      ...values,
    });
  }

  return true;
}

export async function recordRunningPrs(
  tx: Tx,
  args: RunningPrArgs,
): Promise<RunningPrResults> {
  const distanceMeter =
    args.distanceMeter != null && args.distanceMeter > 0
      ? args.distanceMeter
      : null;
  const bestPace =
    distanceMeter != null &&
    args.durationMinutes != null &&
    args.durationMinutes > 0
      ? (args.durationMinutes * 60) / (distanceMeter / 1000)
      : null;

  return {
    longestDistance: await recordPr(tx, {
      userId: args.userId,
      exerciseId: args.exerciseId,
      recordType: "longest_distance",
      candidate: distanceMeter,
      workoutId: args.workoutId,
      dateAchieved: args.dateAchieved,
    }),
    bestPace: await recordPr(tx, {
      userId: args.userId,
      exerciseId: args.exerciseId,
      recordType: "best_pace",
      candidate: bestPace,
      workoutId: args.workoutId,
      dateAchieved: args.dateAchieved,
    }),
  };
}

function maxNonNull(values: Array<number | null | undefined>): number | null {
  let max: number | null = null;

  for (const value of values) {
    if (value == null) continue;
    if (max == null || value > max) {
      max = value;
    }
  }

  return max;
}

function computeMaxVolume(sets: StrengthSetInput[]): number | null {
  let total = 0;
  let hasWeightedSet = false;

  for (const set of sets) {
    if (set.weight == null || set.reps == null) continue;

    hasWeightedSet = true;
    total += set.weight * set.reps;
  }

  return hasWeightedSet ? total : null;
}

export async function recordStrengthPrs(
  tx: Tx,
  args: StrengthPrArgs,
): Promise<StrengthPrResults> {
  return {
    maxWeight: await recordPr(tx, {
      userId: args.userId,
      exerciseId: args.exerciseId,
      recordType: "max_weight",
      candidate: maxNonNull(args.sets.map((set) => set.weight)),
      workoutId: args.workoutId,
      dateAchieved: args.dateAchieved,
    }),
    maxReps: await recordPr(tx, {
      userId: args.userId,
      exerciseId: args.exerciseId,
      recordType: "max_reps",
      candidate: maxNonNull(args.sets.map((set) => set.reps)),
      workoutId: args.workoutId,
      dateAchieved: args.dateAchieved,
    }),
    maxVolume: await recordPr(tx, {
      userId: args.userId,
      exerciseId: args.exerciseId,
      recordType: "max_volume",
      candidate: computeMaxVolume(args.sets),
      workoutId: args.workoutId,
      dateAchieved: args.dateAchieved,
    }),
  };
}
