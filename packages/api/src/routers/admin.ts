import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { db } from "@src/db";
import {
  exercise,
  notification,
  user,
  workoutTemplate,
  workoutTemplateExercise,
} from "@src/db/schema/index";

import { adminProcedure, router } from "../index";

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
  exerciseType: z.enum([
    "weightlifting",
    "hiit",
    "cardio",
    "calisthenics",
    "yoga",
    "sports",
    "mixed",
  ]),
  muscleGroupsBodybuilding: z
    .array(
      z.enum(["chest", "back", "shoulders", "arms", "legs", "core"]),
    )
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
  workoutType: z.enum([
    "weightlifting",
    "hiit",
    "cardio",
    "calisthenics",
    "yoga",
    "sports",
    "mixed",
  ]),
  notes: z.string().optional(),
  exercises: z.array(templateExerciseInput).default([]),
});

export const adminRouter = router({
  isAdmin: adminProcedure.query(() => true),
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
            input.exercises.map((exerciseInput) => ({
              id: crypto.randomUUID(),
              workoutTemplateId: createdTemplate.id,
              exerciseId: exerciseInput.exerciseId,
              order: exerciseInput.order,
              defaultSets: exerciseInput.defaultSets,
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
          .where(eq(workoutTemplateExercise.workoutTemplateId, updatedTemplate.id));

        if (input.exercises.length) {
          await tx.insert(workoutTemplateExercise).values(
            input.exercises.map((exerciseInput) => ({
              id: crypto.randomUUID(),
              workoutTemplateId: updatedTemplate.id,
              exerciseId: exerciseInput.exerciseId,
              order: exerciseInput.order,
              defaultSets: exerciseInput.defaultSets,
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
