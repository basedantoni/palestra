import { eq } from "drizzle-orm";

import {
  exercise,
  exerciseCategoryEnum,
  exerciseLog,
  exerciseSet,
  workout,
  workoutTypeEnum,
} from "@src/db/schema/index";

import * as personalRecords from "./personal-records";
import type { Tx } from "./personal-records";
import { computeWorkoutTotalVolume } from "./workout-utils";

type WorkoutType = (typeof workoutTypeEnum.enumValues)[number];
type ExerciseCategory = (typeof exerciseCategoryEnum.enumValues)[number];
type ExerciseLogInsert = typeof exerciseLog.$inferInsert;
type WorkoutRow = typeof workout.$inferSelect;

export type WorkoutLogPrKind = "running" | "strength" | "none";

export type CreateWorkoutExerciseMetadata = {
  category: ExerciseCategory | null;
};

export type CreateWorkoutSetInput = {
  id?: string;
  setNumber: number;
  reps?: number | null;
  weight?: number | null;
  rpe?: number | null;
  durationSeconds?: number | null;
};

export type CreateWorkoutLogInput = {
  id?: string;
  exerciseId?: string | null;
  exerciseName: string;
  order: number;
  rounds?: number | null;
  workDurationSeconds?: number | null;
  restDurationSeconds?: number | null;
  intensity?: number | null;
  distanceMeter?: number | null;
  durationSeconds?: number | null;
  heartRate?: number | null;
  durationMinutes?: number | null;
  notes?: string | null;
  hrZoneDurations?: ExerciseLogInsert["hrZoneDurations"] | null;
  sets?: CreateWorkoutSetInput[] | null;
  prKind?: WorkoutLogPrKind;
};

export type CreateWorkoutWithLogsInput = {
  id?: string;
  userId: string;
  date: Date;
  workoutType: WorkoutType;
  durationMinutes?: number | null;
  templateId?: string | null;
  notes?: string | null;
  source?: string | null;
  whoopActivityId?: string | null;
  logs: CreateWorkoutLogInput[];
  exerciseMetadataById?: ReadonlyMap<string, CreateWorkoutExerciseMetadata>;
};

export type CreatedWorkoutLog = {
  id: string;
  workoutId: string;
  exerciseId: string | null;
  prKind: WorkoutLogPrKind;
};

export type CreateWorkoutWithLogsResult = {
  workout: WorkoutRow;
  logs: CreatedWorkoutLog[];
};

async function executeInsertReturningFirst<T>(
  query: unknown,
): Promise<T | null> {
  const returning = (query as { returning?: () => Promise<T[]> }).returning;
  if (typeof returning === "function") {
    const rows = await returning.call(query);
    return rows[0] ?? null;
  }

  await query;
  return null;
}

async function resolvePrKind(
  tx: Tx,
  log: CreateWorkoutLogInput,
  metadataByExerciseId?: ReadonlyMap<string, CreateWorkoutExerciseMetadata>,
): Promise<WorkoutLogPrKind> {
  if (log.prKind) return log.prKind;
  if (!log.exerciseId) return "none";

  let metadata = metadataByExerciseId?.get(log.exerciseId);
  if (!metadata) {
    const [row] = await tx
      .select({ category: exercise.category })
      .from(exercise)
      .where(eq(exercise.id, log.exerciseId))
      .limit(1);
    metadata = row ?? undefined;
  }

  if (metadata?.category === "cardio") return "running";
  return log.sets?.length ? "strength" : "none";
}

async function recordPrsForLog(
  tx: Tx,
  args: {
    userId: string;
    workoutId: string;
    dateAchieved: Date;
    log: CreateWorkoutLogInput;
    prKind: WorkoutLogPrKind;
  },
): Promise<void> {
  if (!args.log.exerciseId || args.prKind === "none") return;

  if (args.prKind === "running") {
    await personalRecords.recordRunningPrs(tx, {
      userId: args.userId,
      exerciseId: args.log.exerciseId,
      workoutId: args.workoutId,
      dateAchieved: args.dateAchieved,
      distanceMeter: args.log.distanceMeter,
      durationMinutes: args.log.durationMinutes,
    });
    return;
  }

  if (args.log.sets?.length) {
    await personalRecords.recordStrengthPrs(tx, {
      userId: args.userId,
      exerciseId: args.log.exerciseId,
      workoutId: args.workoutId,
      dateAchieved: args.dateAchieved,
      sets: args.log.sets,
    });
  }
}

export async function createWorkoutWithLogs(
  tx: Tx,
  input: CreateWorkoutWithLogsInput,
): Promise<CreateWorkoutWithLogsResult> {
  const requestedWorkoutId = input.id ?? crypto.randomUUID();
  const totalVolume = computeWorkoutTotalVolume(input.logs);
  const now = new Date();

  const returnedWorkout = await executeInsertReturningFirst<WorkoutRow>(
    tx.insert(workout).values({
      id: requestedWorkoutId,
      userId: input.userId,
      date: input.date,
      workoutType: input.workoutType,
      durationMinutes: input.durationMinutes,
      templateId: input.templateId,
      notes: input.notes,
      totalVolume,
      source: input.source,
      whoopActivityId: input.whoopActivityId,
    }),
  );

  const workoutId = returnedWorkout?.id ?? requestedWorkoutId;

  const createdLogs: CreatedWorkoutLog[] = [];

  for (const log of input.logs) {
    const requestedLogId = log.id ?? crypto.randomUUID();
    const prKind = await resolvePrKind(tx, log, input.exerciseMetadataById);

    const returnedLog = await executeInsertReturningFirst<
      typeof exerciseLog.$inferSelect
    >(
      tx.insert(exerciseLog).values({
        id: requestedLogId,
        workoutId,
        exerciseId: log.exerciseId,
        exerciseName: log.exerciseName,
        order: log.order,
        rounds: log.rounds,
        workDurationSeconds: log.workDurationSeconds,
        restDurationSeconds: log.restDurationSeconds,
        intensity: log.intensity,
        distanceMeter: log.distanceMeter,
        durationSeconds: log.durationSeconds,
        heartRate: log.heartRate,
        durationMinutes: log.durationMinutes,
        notes: log.notes,
        hrZoneDurations: log.hrZoneDurations,
      }),
    );
    const logId = returnedLog?.id ?? requestedLogId;

    if (log.sets?.length) {
      await tx.insert(exerciseSet).values(
        log.sets.map((set) => ({
          id: set.id ?? crypto.randomUUID(),
          exerciseLogId: logId,
          setNumber: set.setNumber,
          reps: set.reps,
          weight: set.weight,
          rpe: set.rpe,
          durationSeconds: set.durationSeconds,
        })),
      );
    }

    await recordPrsForLog(tx, {
      userId: input.userId,
      workoutId,
      dateAchieved: input.date,
      log,
      prKind,
    });

    createdLogs.push({
      id: logId,
      workoutId,
      exerciseId: log.exerciseId ?? null,
      prKind,
    });
  }

  return {
    workout: returnedWorkout ?? {
      id: workoutId,
      userId: input.userId,
      date: input.date,
      workoutType: input.workoutType,
      durationMinutes: input.durationMinutes ?? null,
      templateId: input.templateId ?? null,
      notes: input.notes ?? null,
      totalVolume,
      source: input.source ?? null,
      whoopActivityId: input.whoopActivityId ?? null,
      createdAt: now,
      updatedAt: now,
    },
    logs: createdLogs,
  };
}
