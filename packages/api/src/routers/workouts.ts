import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@src/db";
import {
  exercise,
  exerciseLog,
  exerciseSet,
  workout,
  workoutTemplate,
  workoutTemplateExercise,
} from "@src/db/schema/index";
import { whoopActivityToExerciseLog } from "@src/shared";

import { protectedProcedure, router } from "../index";
import { recalculateProgressiveOverload } from "../lib/progressive-overload-db";
import { recalculateMuscleGroupVolumeForWeek } from "../lib/muscle-group-volume-db";
import { recordRunningPrs, recordStrengthPrs } from "../lib/personal-records";
import { WHOOP_API_BASE, getValidWhoopAccessToken } from "../lib/whoop-client";
import { WORKOUT_TYPE_ENUM } from "../lib/workout-utils";

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
  distanceMeter: z.number().min(0).optional(),
  durationSeconds: z.number().int().min(0).optional(),
  heartRate: z.number().int().min(0).optional(),
  durationMinutes: z.number().int().min(0).optional(),
  notes: z.string().optional(),
  sets: z.array(exerciseSetInput).optional(),
});

const workoutInput = z.object({
  date: z.coerce.date(),
  workoutType: WORKOUT_TYPE_ENUM,
  durationMinutes: z.number().int().min(0).optional(),
  templateId: z.string().uuid().optional(),
  notes: z.string().optional(),
  totalVolume: z.number().min(0).optional(),
  logs: z.array(exerciseLogInput).default([]),
  whoopActivityId: z.string().optional(),
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

type WorkoutsTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ExerciseLogInputItem = z.infer<typeof exerciseLogInput>;

async function insertExerciseLogAndSets(
  tx: WorkoutsTx,
  workoutId: string,
  log: ExerciseLogInputItem,
): Promise<(typeof exerciseLog.$inferSelect) | undefined> {
  const logId = crypto.randomUUID();
  const [createdLog] = await tx
    .insert(exerciseLog)
    .values({
      id: logId,
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

  return createdLog;
}

function fireAndForgetRecalcs(
  userId: string,
  exerciseIds: string[],
  date: Date,
): void {
  if (exerciseIds.length > 0) {
    recalculateProgressiveOverload(userId, exerciseIds).catch(
      (err) => console.error("Progressive overload recalc failed:", err),
    );
  }
  recalculateMuscleGroupVolumeForWeek(userId, date).catch(
    (err) => console.error("Muscle group volume recalc failed:", err),
  );
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
                  cardioSubtype: true,
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

      // Track which exercise has cardioSubtype=running for Whoop metric application
      const cardioSubtypeByExerciseId = new Map<string, string>();

      if (exerciseIds.length > 0) {
        const exerciseRows = await db
          .select({
            id: exercise.id,
            category: exercise.category,
            cardioSubtype: exercise.cardioSubtype,
          })
          .from(exercise)
          .where(inArray(exercise.id, exerciseIds));

        for (const row of exerciseRows) {
          if (row.category === "cardio") {
            runningExerciseIdSet.add(row.id);
          }
          if (row.cardioSubtype) {
            cardioSubtypeByExerciseId.set(row.id, row.cardioSubtype);
          }
        }
      }

      // If a Whoop activity is being linked, fetch its data before the transaction
      let whoopPatch: ReturnType<typeof whoopActivityToExerciseLog> | null = null;
      if (input.whoopActivityId) {
        try {
          const accessToken = await getValidWhoopAccessToken(ctx.session.user.id);
          const response = await fetch(
            `${WHOOP_API_BASE}/activity/workout/${input.whoopActivityId}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (response.ok) {
            const whoopActivity = await response.json() as import("@src/shared").WhoopActivityScore;
            whoopPatch = whoopActivityToExerciseLog(whoopActivity);
          }
          // On fetch failure, proceed without Whoop data — don't block save
        } catch {
          // Whoop unavailable: save normally without linking
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
            // Set whoopActivityId only if we successfully fetched the activity
            whoopActivityId: whoopPatch && input.whoopActivityId ? input.whoopActivityId : undefined,
          })
          .returning();

        // Track the first running exercise log created so we can apply Whoop metrics
        let firstRunningLogId: string | null = null;

        for (const log of input.logs) {
          const isRunningExercise =
            log.exerciseId != null &&
            cardioSubtypeByExerciseId.get(log.exerciseId) === "running";

          const createdLog = await insertExerciseLogAndSets(
            tx,
            newWorkout!.id,
            log,
          );

          // Track first running exercise log for Whoop metric application
          if (isRunningExercise && firstRunningLogId === null && createdLog) {
            firstRunningLogId = createdLog.id;
          }

          if (createdLog && log.exerciseId) {
            if (runningExerciseIdSet.has(log.exerciseId)) {
              await recordRunningPrs(tx, {
                userId: ctx.session.user.id,
                exerciseId: log.exerciseId,
                workoutId: newWorkout!.id,
                dateAchieved: input.date,
                distanceMeter: log.distanceMeter,
                durationMinutes: log.durationMinutes,
              });
            } else if (log.sets?.length) {
              await recordStrengthPrs(tx, {
                userId: ctx.session.user.id,
                exerciseId: log.exerciseId,
                workoutId: newWorkout!.id,
                dateAchieved: input.date,
                sets: log.sets,
              });
            }
          }
        }

        // Apply Whoop metrics to the first running exercise log
        if (whoopPatch && firstRunningLogId) {
          await tx
            .update(exerciseLog)
            .set({
              heartRate: whoopPatch.heartRate,
              intensity: whoopPatch.intensity,
              distanceMeter: whoopPatch.distanceMeter ?? undefined,
              durationMinutes: whoopPatch.durationMinutes ?? undefined,
              hrZoneDurations: whoopPatch.hrZoneDurations,
            })
            .where(eq(exerciseLog.id, firstRunningLogId));
        }

        return newWorkout;
      });

      fireAndForgetRecalcs(ctx.session.user.id, exerciseIds, input.date);

      return createdWorkout;
    }),
  update: protectedProcedure
    .input(workoutInput.extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const exerciseIds = Array.from(
        new Set(
          input.logs
            .map((log) => log.exerciseId)
            .filter((id): id is string => id != null),
        ),
      );

      const runningExerciseIdSet = new Set<string>();
      if (exerciseIds.length > 0) {
        const exerciseRows = await db
          .select({ id: exercise.id, category: exercise.category })
          .from(exercise)
          .where(inArray(exercise.id, exerciseIds));
        for (const row of exerciseRows) {
          if (row.category === "cardio") runningExerciseIdSet.add(row.id);
        }
      }

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
          const createdLog = await insertExerciseLogAndSets(tx, updated.id, log);
          if (createdLog && log.exerciseId) {
            if (runningExerciseIdSet.has(log.exerciseId)) {
              await recordRunningPrs(tx, {
                userId: ctx.session.user.id,
                exerciseId: log.exerciseId,
                workoutId: updated.id,
                dateAchieved: input.date,
                distanceMeter: log.distanceMeter,
                durationMinutes: log.durationMinutes,
              });
            } else if (log.sets?.length) {
              await recordStrengthPrs(tx, {
                userId: ctx.session.user.id,
                exerciseId: log.exerciseId,
                workoutId: updated.id,
                dateAchieved: input.date,
                sets: log.sets,
              });
            }
          }
        }

        return updated;
      });

      if (updatedWorkout) {
        fireAndForgetRecalcs(ctx.session.user.id, exerciseIds, input.date);
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
