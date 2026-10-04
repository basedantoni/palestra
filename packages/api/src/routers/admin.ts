import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { db } from "@life-tracker/db";
import {
  category,
  exercise,
  exerciseLog,
  exerciseSet,
  notification,
  personalRecord,
  transaction,
  user,
  workout,
  workoutTemplate,
  workoutTemplateExercise,
} from "@life-tracker/db/schema/index";

import { adminProcedure, router } from "../index";
import { isManualCategory } from "../lib/category-rules";
import { recordRunningPrs, recordStrengthPrs } from "../lib/personal-records";
import { WORKOUT_TYPE_ENUM } from "../lib/workout-utils";

const exerciseInput = z.object({
  name: z.string().min(1),
  category: z.enum([
    "chest",
    "back",
    "shoulders",
    "arms",
    "legs",
    "core",
    "cardio",
    "other",
  ]),
  exerciseType: WORKOUT_TYPE_ENUM,
  muscleGroupsBodybuilding: z
    .array(z.enum(["chest", "back", "shoulders", "arms", "legs", "core"]))
    .optional(),
  muscleGroupsMovement: z
    .array(z.enum(["push", "pull", "squat", "hinge", "carry"]))
    .optional(),
});

const templateExerciseInput = z.object({
  exerciseId: z.string().uuid().optional(),
  order: z.number().int().min(0),
  defaultSets: z.number().int().min(1).optional(),
});

const templateInput = z.object({
  name: z.string().min(1),
  workoutType: WORKOUT_TYPE_ENUM,
  notes: z.string().optional(),
  exercises: z.array(templateExerciseInput).default([]),
});

export const adminRouter = router({
  isAdmin: adminProcedure.query(() => true),
  // ---------------------------------------------------------------------------
  // Backfill: flag existing transactions whose category was picked by hand
  // (KOI-297, ADR 0004). Before the flag existed nothing recorded this, so it is
  // inferred: a category that differs from the recomputed Default Category is
  // manual. Run ONCE, right after the migration — once Category Rules exist, a
  // rule-applied category also differs from the default and would be misread.
  // ---------------------------------------------------------------------------
  backfillManualCategories: adminProcedure.mutation(async () => {
    return db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: transaction.id,
          userId: transaction.userId,
          categoryId: transaction.categoryId,
          plaidCategoryPrimary: transaction.plaidCategoryPrimary,
        })
        .from(transaction);
      const categories = await tx
        .select({ id: category.id, userId: category.userId, name: category.name })
        .from(category);

      const categoryByNameByUser = new Map<string, Map<string, string>>();
      for (const c of categories) {
        const byName = categoryByNameByUser.get(c.userId) ?? new Map<string, string>();
        byName.set(c.name, c.id);
        categoryByNameByUser.set(c.userId, byName);
      }

      const manualIds = rows
        .filter((r) =>
          isManualCategory(
            r.categoryId,
            r.plaidCategoryPrimary,
            categoryByNameByUser.get(r.userId) ?? new Map(),
          ),
        )
        .map((r) => r.id);
      // Chunked to stay well under Postgres' bind-parameter limit.
      const CHUNK = 1000;
      for (let i = 0; i < manualIds.length; i += CHUNK) {
        await tx
          .update(transaction)
          .set({ categoryOverridden: true })
          .where(inArray(transaction.id, manualIds.slice(i, i + CHUNK)));
      }
      return { processed: rows.length, manual: manualIds.length };
    });
  }),
  // ---------------------------------------------------------------------------
  // Backfill: reprocess every existing workout to populate the personal_record
  // table from scratch (KOI-80). Reuses the SAME live functions used by the
  // workout-create path (recordRunningPrs / recordStrengthPrs), so the
  // progression chain (previousRecordValue) matches what the live path produces.
  //
  // Idempotency: we do NOT delete existing PRs up front. Instead we skip any
  // (workout, exercise) that already has personal_record rows. This matters
  // because the PR table is a *timeline* — recordPr keeps one row per workout
  // that set a record at the time, and its delete branch culls a same-workout
  // row that no longer beats OTHER workouts. Re-running over already-recorded
  // workouts would therefore delete superseded historical rows (lossy). Guarding
  // on "already has rows" makes a re-run a true no-op: identical rows, and
  // prsRecorded counts only rows genuinely (re)built this run.
  // ---------------------------------------------------------------------------
  backfillPersonalRecords: adminProcedure.mutation(async () => {
    return db.transaction(async (tx) => {
      // Oldest-first per user so the progression chain builds correctly:
      // recordPr reads the prior best from rows already written for earlier
      // workouts, so a wrong order would corrupt previousRecordValue.
      const workouts = await tx
        .select({
          id: workout.id,
          userId: workout.userId,
          date: workout.date,
        })
        .from(workout)
        .orderBy(asc(workout.userId), asc(workout.date));

      // Pre-load the (workoutId, exerciseId) pairs that already have PR rows so
      // re-running skips them — see the idempotency note above.
      const existingPrRows = await tx
        .select({
          workoutId: personalRecord.workoutId,
          exerciseId: personalRecord.exerciseId,
        })
        .from(personalRecord);

      const alreadyRecorded = new Set<string>();
      for (const row of existingPrRows) {
        if (row.workoutId && row.exerciseId) {
          alreadyRecorded.add(`${row.workoutId}:${row.exerciseId}`);
        }
      }

      let processed = 0;
      let prsRecorded = 0;

      for (const w of workouts) {
        processed += 1;

        // Load this workout's logs joined with their exercise so we know the
        // cardioSubtype (running vs strength dispatch). exerciseId may be null
        // for free-text logs — those rows are skipped below.
        const logs = await tx
          .select({
            id: exerciseLog.id,
            exerciseId: exerciseLog.exerciseId,
            distanceMeter: exerciseLog.distanceMeter,
            durationMinutes: exerciseLog.durationMinutes,
            cardioSubtype: exercise.cardioSubtype,
          })
          .from(exerciseLog)
          .leftJoin(exercise, eq(exerciseLog.exerciseId, exercise.id))
          .where(eq(exerciseLog.workoutId, w.id));

        // One recordPr-group call per log — matching the live workouts.create
        // path, which iterates logs and calls recordRunningPrs/recordStrengthPrs
        // per log without aggregating logs that share an exerciseId.
        for (const log of logs) {
          // Skip logs with no exerciseId — PRs are keyed by exercise.
          if (!log.exerciseId) continue;

          // Idempotency guard: this (workout, exercise) already has PR rows.
          if (alreadyRecorded.has(`${w.id}:${log.exerciseId}`)) continue;

          const isRunning =
            log.cardioSubtype === "running" || log.distanceMeter != null;

          if (isRunning) {
            const results = await recordRunningPrs(tx, {
              userId: w.userId,
              exerciseId: log.exerciseId,
              workoutId: w.id,
              dateAchieved: w.date,
              distanceMeter: log.distanceMeter,
              durationMinutes: log.durationMinutes,
            });
            if (results.longestDistance) prsRecorded += 1;
            if (results.bestPace) prsRecorded += 1;
          } else {
            const sets = await tx
              .select({
                reps: exerciseSet.reps,
                weight: exerciseSet.weight,
              })
              .from(exerciseSet)
              .where(eq(exerciseSet.exerciseLogId, log.id));

            const results = await recordStrengthPrs(tx, {
              userId: w.userId,
              exerciseId: log.exerciseId,
              workoutId: w.id,
              dateAchieved: w.date,
              sets,
            });
            if (results.maxWeight) prsRecorded += 1;
            if (results.maxReps) prsRecorded += 1;
            if (results.maxVolume) prsRecorded += 1;
          }
        }
      }

      return { processed, prsRecorded };
    });
  }),
  exercisesList: adminProcedure.query(async () => {
    return db.select().from(exercise).orderBy(exercise.name);
  }),
  exercisesCreate: adminProcedure
    .input(exerciseInput)
    .mutation(async ({ input }) => {
      const [created] = await db
        .insert(exercise)
        .values({
          id: crypto.randomUUID(),
          name: input.name,
          category: input.category,
          muscleGroupsBodybuilding: input.muscleGroupsBodybuilding,
          muscleGroupsMovement: input.muscleGroupsMovement,
          exerciseType: input.exerciseType,
          isCustom: false,
          createdByUserId: null,
        })
        .returning();
      return created!;
    }),
  exercisesUpdate: adminProcedure
    .input(
      exerciseInput.extend({
        id: z.string().uuid(),
      }),
    )
    .mutation(async ({ input }) => {
      const [updated] = await db
        .update(exercise)
        .set({
          name: input.name,
          category: input.category,
          muscleGroupsBodybuilding: input.muscleGroupsBodybuilding,
          muscleGroupsMovement: input.muscleGroupsMovement,
          exerciseType: input.exerciseType,
        })
        .where(and(eq(exercise.id, input.id), eq(exercise.isCustom, false)))
        .returning();
      return updated ?? null;
    }),
  exercisesDelete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [deleted] = await db
        .delete(exercise)
        .where(and(eq(exercise.id, input.id), eq(exercise.isCustom, false)))
        .returning();
      return deleted ?? null;
    }),
  // ---------------------------------------------------------------------------
  // Pending custom exercise review queue
  // ---------------------------------------------------------------------------
  pendingExercises: adminProcedure.query(async () => {
    return db
      .select({
        exercise: exercise,
        submittedBy: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      })
      .from(exercise)
      .innerJoin(user, eq(exercise.createdByUserId, user.id))
      .where(
        and(
          eq(exercise.isCustom, true),
          inArray(exercise.status, ["pending", "imported"]),
        ),
      )
      .orderBy(exercise.createdAt);
  }),
  approveExercise: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return db.transaction(async (tx) => {
        const [updated] = await tx
          .update(exercise)
          .set({
            isCustom: false,
            status: "approved",
            approvedAt: new Date(),
            approvedByUserId: ctx.session.user.id,
          })
          .where(
            and(
              eq(exercise.id, input.id),
              eq(exercise.isCustom, true),
              inArray(exercise.status, ["pending", "imported"]),
            ),
          )
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Pending exercise not found",
          });
        }

        if (updated.createdByUserId) {
          await tx.insert(notification).values({
            id: crypto.randomUUID(),
            userId: updated.createdByUserId,
            type: "custom_exercise_approved",
            title: "Exercise Approved!",
            message: `Your exercise "${updated.name}" has been approved and added to the public library.`,
            payload: { exerciseId: updated.id, exerciseName: updated.name },
          });
        }

        return updated;
      });
    }),
  rejectExercise: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const [updated] = await db
        .update(exercise)
        .set({
          status: "rejected",
          rejectedReason: input.reason ?? null,
        })
        .where(
          and(
            eq(exercise.id, input.id),
            eq(exercise.isCustom, true),
            inArray(exercise.status, ["pending", "imported"]),
          ),
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pending exercise not found",
        });
      }

      return updated;
    }),
  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------
  templatesList: adminProcedure.query(async () => {
    return db
      .select()
      .from(workoutTemplate)
      .where(eq(workoutTemplate.isSystemTemplate, true))
      .orderBy(workoutTemplate.name);
  }),
  templatesCreate: adminProcedure
    .input(templateInput)
    .mutation(async ({ input }) => {
      return db.transaction(async (tx) => {
        const templateId = crypto.randomUUID();
        const [createdTemplate] = await tx
          .insert(workoutTemplate)
          .values({
            id: templateId,
            userId: null,
            name: input.name,
            workoutType: input.workoutType,
            notes: input.notes,
            isSystemTemplate: true,
          })
          .returning();

        if (input.exercises.length && createdTemplate) {
          await tx.insert(workoutTemplateExercise).values(
            input.exercises.map((templateExercise) => ({
              id: crypto.randomUUID(),
              workoutTemplateId: createdTemplate.id,
              exerciseId: templateExercise.exerciseId,
              order: templateExercise.order,
              defaultSets: templateExercise.defaultSets,
            })),
          );
        }

        return createdTemplate!;
      });
    }),
  templatesUpdate: adminProcedure
    .input(templateInput.extend({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      return db.transaction(async (tx) => {
        const [updatedTemplate] = await tx
          .update(workoutTemplate)
          .set({
            name: input.name,
            workoutType: input.workoutType,
            notes: input.notes,
          })
          .where(
            and(
              eq(workoutTemplate.id, input.id),
              eq(workoutTemplate.isSystemTemplate, true),
            ),
          )
          .returning();

        if (!updatedTemplate) {
          return null;
        }

        await tx
          .delete(workoutTemplateExercise)
          .where(
            eq(workoutTemplateExercise.workoutTemplateId, updatedTemplate.id),
          );

        if (input.exercises.length) {
          await tx.insert(workoutTemplateExercise).values(
            input.exercises.map((templateExercise) => ({
              id: crypto.randomUUID(),
              workoutTemplateId: updatedTemplate.id,
              exerciseId: templateExercise.exerciseId,
              order: templateExercise.order,
              defaultSets: templateExercise.defaultSets,
            })),
          );
        }

        return updatedTemplate;
      });
    }),
  templatesDelete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [deleted] = await db
        .delete(workoutTemplate)
        .where(
          and(
            eq(workoutTemplate.id, input.id),
            eq(workoutTemplate.isSystemTemplate, true),
          ),
        )
        .returning();
      return deleted ?? null;
    }),
});
