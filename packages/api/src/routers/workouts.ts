import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@src/db";
import {
  exercise,
  exerciseLog,
  exerciseSet,
  personalRecord,
  workout,
  workoutTemplate,
  workoutTemplateExercise,
} from "@src/db/schema/index";

import { protectedProcedure, router } from "../index";
import { recalculateProgressiveOverload } from "../lib/progressive-overload-db";
import { recalculateMuscleGroupVolumeForWeek } from "../lib/muscle-group-volume-db";

const workoutTypeEnum = z.enum([
  "weightlifting",
  "hiit",
  "cardio",
  "mobility",
  "calisthenics",
  "yoga",
  "sports",
  "mixed",
]);

const exerciseSetInput = z
  .object({
    setNumber: z.number().int().min(1),
    reps: z.number().int().min(0).optional(),
    weight: z.number().min(0).optional(),
    rpe: z.number().int().min(1).max(10).optional(),
    durationSeconds: z.number().int().min(1).optional(),
  })
  .refine((s) => s.reps !== undefined || s.durationSeconds !== undefined, {
    message: "A set must have either reps or durationSeconds",
  });

const exerciseLogInput = z.object({
  exerciseId: z.string().uuid().optional(),
  exerciseName: z.string().min(1),
  order: z.number().int().min(0),
  rounds: z.number().int().min(1).optional(),
  workDurationSeconds: z.number().int().min(0).optional(),
  restDurationSeconds: z.number().int().min(0).optional(),
  intensity: z.number().int().min(0).max(100).optional(),
  distance: z.number().min(0).optional(),
  durationSeconds: z.number().int().min(0).optional(),
  pace: z.number().min(0).optional(),
  heartRate: z.number().int().min(0).optional(),
  durationMinutes: z.number().int().min(0).optional(),
  notes: z.string().optional(),
  sets: z.array(exerciseSetInput).optional(),
});

const workoutInput = z.object({
  date: z.coerce.date(),
  workoutType: workoutTypeEnum,
  durationMinutes: z.number().int().min(0).optional(),
  templateId: z.string().uuid().optional(),
  notes: z.string().optional(),
  totalVolume: z.number().min(0).optional(),
  logs: z.array(exerciseLogInput).default([]),
});

function toUtcDayBoundary(date: Date, endOfDay: boolean): Date {
  return new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0,
    ),
  );
}

type RunningPrRecordType = "best_pace" | "longest_distance";

function isBetterRunningPr(
  recordType: RunningPrRecordType,
  candidate: number,
  currentBest: number | undefined,
): boolean {
  if (currentBest == null) return true;
  return recordType === "best_pace"
    ? candidate < currentBest
    : candidate > currentBest;
}

export const workoutsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;
      return db
        .select()
        .from(workout)
        .where(eq(workout.userId, ctx.session.user.id))
        .orderBy(desc(workout.date))
        .limit(limit)
        .offset(offset);
    }),
  listWithSummary: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;

      const workouts = await db.query.workout.findMany({
        where: (table, { eq }) => eq(table.userId, ctx.session.user.id),
        orderBy: (table, { desc }) => [desc(table.date)],
        limit,
        offset,
        with: {
          logs: {
            columns: {
              id: true,
              exerciseName: true,
            },
          },
        },
      });

      return workouts.map((w) => ({
        ...w,
        exerciseCount: w.logs.length,
        exerciseNames: w.logs.map((l) => l.exerciseName),
        logs: undefined,
      }));
    }),
  calendarRange: protectedProcedure
    .input(
      z.object({
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const startDate = toUtcDayBoundary(input.startDate, false);
      const endDate = toUtcDayBoundary(input.endDate, true);
      const workouts = await db.query.workout.findMany({
        where: (table, { and, eq, gte, lte }) =>
          and(
            eq(table.userId, ctx.session.user.id),
            gte(table.date, startDate),
            lte(table.date, endDate),
          ),
        orderBy: (table, { desc }) => [desc(table.date)],
        with: {
          logs: {
            columns: {
              id: true,
              exerciseName: true,
            },
          },
        },
      });

      return workouts.map((w) => ({
        ...w,
        exerciseCount: w.logs.length,
        exerciseNames: w.logs.map((l) => l.exerciseName),
        logs: undefined,
      }));
    }),
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.query.workout.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.id, input.id), eq(table.userId, ctx.session.user.id)),
        with: {
          logs: {
            with: {
              sets: true,
              exercise: {
                columns: {
                  exerciseType: true,
                },
              },
            },
          },
        },
      });
    }),
  create: protectedProcedure
    .input(workoutInput)
    .mutation(async ({ ctx, input }) => {
      const exerciseIds = Array.from(
        new Set(
          input.logs
            .map((log) => log.exerciseId)
            .filter((id): id is string => id != null),
        ),
      );

      const runningExerciseIdSet = new Set<string>();
      const runningPrByKey = new Map<string, number>();

      if (exerciseIds.length > 0) {
        const exerciseRows = await db
          .select({
            id: exercise.id,
            category: exercise.category,
          })
          .from(exercise)
          .where(inArray(exercise.id, exerciseIds));

        for (const row of exerciseRows) {
          if (row.category === "cardio") {
            runningExerciseIdSet.add(row.id);
          }
        }

        if (runningExerciseIdSet.size > 0) {
          const existingRecords = await db
            .select({
              exerciseId: personalRecord.exerciseId,
              recordType: personalRecord.recordType,
              value: personalRecord.value,
            })
            .from(personalRecord)
            .where(
              and(
                eq(personalRecord.userId, ctx.session.user.id),
                inArray(
                  personalRecord.exerciseId,
                  Array.from(runningExerciseIdSet),
                ),
              ),
            );

          for (const record of existingRecords) {
            if (
              record.exerciseId == null ||
              (record.recordType !== "best_pace" &&
                record.recordType !== "longest_distance")
            ) {
              continue;
            }

            const key = `${record.exerciseId}:${record.recordType}`;
            const currentBest = runningPrByKey.get(key);
            if (
              currentBest == null ||
              isBetterRunningPr(record.recordType, record.value, currentBest)
            ) {
              runningPrByKey.set(key, record.value);
            }
          }
        }
      }

      const createdWorkout = await db.transaction(async (tx) => {
        const workoutId = crypto.randomUUID();
        const [newWorkout] = await tx
          .insert(workout)
          .values({
            id: workoutId,
            userId: ctx.session.user.id,
            date: input.date,
            workoutType: input.workoutType,
            durationMinutes: input.durationMinutes,
            templateId: input.templateId,
            notes: input.notes,
            totalVolume: input.totalVolume,
          })
          .returning();

        for (const log of input.logs) {
          const logId = crypto.randomUUID();
          const [createdLog] = await tx
            .insert(exerciseLog)
            .values({
              id: logId,
              workoutId: newWorkout!.id,
              exerciseId: log.exerciseId,
              exerciseName: log.exerciseName,
              order: log.order,
              rounds: log.rounds,
              workDurationSeconds: log.workDurationSeconds,
              restDurationSeconds: log.restDurationSeconds,
              intensity: log.intensity,
              distance: log.distance,
              durationSeconds: log.durationSeconds,
              pace: log.pace,
              heartRate: log.heartRate,
              durationMinutes: log.durationMinutes,
              notes: log.notes,
            })
            .returning();

          if (log.sets?.length && createdLog) {
            await tx.insert(exerciseSet).values(
              log.sets.map((set) => ({
                id: crypto.randomUUID(),
                exerciseLogId: createdLog.id,
                setNumber: set.setNumber,
                reps: set.reps,
                weight: set.weight,
                rpe: set.rpe,
                durationSeconds: set.durationSeconds,
              })),
            );
          }

          if (
            createdLog &&
            log.exerciseId &&
            runningExerciseIdSet.has(log.exerciseId)
          ) {
            const maybeInsertRunningPr = async (
              recordType: RunningPrRecordType,
              value: number | undefined,
            ) => {
              if (value == null || value <= 0) return;

              const key = `${log.exerciseId}:${recordType}`;
              const currentBest = runningPrByKey.get(key);
              if (!isBetterRunningPr(recordType, value, currentBest)) {
                return;
              }

              await tx.insert(personalRecord).values({
                id: crypto.randomUUID(),
                userId: ctx.session.user.id,
                exerciseId: log.exerciseId,
                recordType,
                value,
                dateAchieved: input.date,
                workoutId: newWorkout!.id,
                previousRecordValue: currentBest ?? null,
              });

              runningPrByKey.set(key, value);
            };

            await maybeInsertRunningPr("longest_distance", log.distance);
            await maybeInsertRunningPr("best_pace", log.pace);
          }
        }

        return newWorkout;
      });

      // Fire and forget — don't block the response on recalculation
      if (exerciseIds.length > 0) {
        recalculateProgressiveOverload(ctx.session.user.id, exerciseIds).catch(
          (err) => console.error("Progressive overload recalc failed:", err),
        );
      }
      recalculateMuscleGroupVolumeForWeek(ctx.session.user.id, input.date).catch(
        (err) => console.error("Muscle group volume recalc failed:", err),
      );

      return createdWorkout;
    }),
  update: protectedProcedure
    .input(workoutInput.extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const updatedWorkout = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(workout)
          .set({
            date: input.date,
            workoutType: input.workoutType,
            durationMinutes: input.durationMinutes,
            templateId: input.templateId,
            notes: input.notes,
            totalVolume: input.totalVolume,
            updatedAt: new Date(),
          })
          .where(
            and(eq(workout.id, input.id), eq(workout.userId, ctx.session.user.id)),
          )
          .returning();

        if (!updated) {
          return null;
        }

        await tx
          .delete(exerciseLog)
          .where(eq(exerciseLog.workoutId, updated.id));

        for (const log of input.logs) {
          const logId = crypto.randomUUID();
          const [createdLog] = await tx
            .insert(exerciseLog)
            .values({
              id: logId,
              workoutId: updated!.id,
              exerciseId: log.exerciseId,
              exerciseName: log.exerciseName,
              order: log.order,
              rounds: log.rounds,
              workDurationSeconds: log.workDurationSeconds,
              restDurationSeconds: log.restDurationSeconds,
              intensity: log.intensity,
              distance: log.distance,
              durationSeconds: log.durationSeconds,
              pace: log.pace,
              heartRate: log.heartRate,
              durationMinutes: log.durationMinutes,
              notes: log.notes,
            })
            .returning();

          if (log.sets?.length && createdLog) {
            await tx.insert(exerciseSet).values(
              log.sets.map((set) => ({
                id: crypto.randomUUID(),
                exerciseLogId: createdLog.id,
                setNumber: set.setNumber,
                reps: set.reps,
                weight: set.weight,
                rpe: set.rpe,
                durationSeconds: set.durationSeconds,
              })),
            );
          }
        }

        return updated;
      });

      // Fire and forget — don't block the response on recalculation
      if (updatedWorkout) {
        const exerciseIds = Array.from(
          new Set(
            input.logs
              .map((log) => log.exerciseId)
              .filter((id): id is string => id != null),
          ),
        );
        if (exerciseIds.length > 0) {
          recalculateProgressiveOverload(ctx.session.user.id, exerciseIds).catch(
            (err) => console.error("Progressive overload recalc failed:", err),
          );
        }
        recalculateMuscleGroupVolumeForWeek(ctx.session.user.id, input.date).catch(
          (err) => console.error("Muscle group volume recalc failed:", err),
        );
      }

      return updatedWorkout;
    }),
  saveAsTemplate: protectedProcedure
    .input(
      z.object({
        workoutId: z.string().uuid(),
        name: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existingWorkout = await db.query.workout.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.id, input.workoutId),
            eq(table.userId, ctx.session.user.id),
          ),
        with: {
          logs: {
            columns: {
              exerciseId: true,
              exerciseName: true,
              order: true,
            },
            with: {
              sets: {
                columns: { id: true },
              },
            },
          },
        },
      });

      if (!existingWorkout) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workout not found",
        });
      }

      return db.transaction(async (tx) => {
        const templateId = crypto.randomUUID();
        const [template] = await tx
          .insert(workoutTemplate)
          .values({
            id: templateId,
            userId: ctx.session.user.id,
            name: input.name,
            workoutType: existingWorkout.workoutType,
            isSystemTemplate: false,
          })
          .returning();

        if (existingWorkout.logs.length) {
          await tx.insert(workoutTemplateExercise).values(
            existingWorkout.logs.map((log) => ({
              id: crypto.randomUUID(),
              workoutTemplateId: templateId,
              exerciseId: log.exerciseId,
              order: log.order,
              defaultSets: log.sets.length || null,
            })),
          );
        }

        return template;
      });
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await db
        .delete(workout)
        .where(
          and(eq(workout.id, input.id), eq(workout.userId, ctx.session.user.id)),
        )
        .returning();
      return deleted ?? null;
    }),
});
