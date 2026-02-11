import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@src/db";
import { exerciseLog, exerciseSet, workout } from "@src/db/schema/index";

import { protectedProcedure, router } from "../index";

const workoutTypeEnum = z.enum([
  "weightlifting",
  "hiit",
  "cardio",
  "calisthenics",
  "yoga",
  "sports",
  "mixed",
]);

const exerciseSetInput = z.object({
  setNumber: z.number().int().min(1),
  reps: z.number().int().min(0).optional(),
  weight: z.number().min(0).optional(),
  rpe: z.number().int().min(1).max(10).optional(),
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
            },
          },
        },
      });
    }),
  create: protectedProcedure
    .input(workoutInput)
    .mutation(async ({ ctx, input }) => {
      return db.transaction(async (tx) => {
        const [createdWorkout] = await tx
          .insert(workout)
          .values({
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
          const [createdLog] = await tx
            .insert(exerciseLog)
            .values({
              workoutId: createdWorkout.id,
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

          if (log.sets?.length) {
            await tx.insert(exerciseSet).values(
              log.sets.map((set) => ({
                exerciseLogId: createdLog.id,
                setNumber: set.setNumber,
                reps: set.reps,
                weight: set.weight,
                rpe: set.rpe,
              })),
            );
          }
        }

        return createdWorkout;
      });
    }),
  update: protectedProcedure
    .input(workoutInput.extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return db.transaction(async (tx) => {
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
          const [createdLog] = await tx
            .insert(exerciseLog)
            .values({
              workoutId: updated.id,
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

          if (log.sets?.length) {
            await tx.insert(exerciseSet).values(
              log.sets.map((set) => ({
                exerciseLogId: createdLog.id,
                setNumber: set.setNumber,
                reps: set.reps,
                weight: set.weight,
                rpe: set.rpe,
              })),
            );
          }
        }

        return updated;
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
