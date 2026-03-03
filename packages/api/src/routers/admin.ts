import { z } from "zod";
import { and, eq } from "drizzle-orm";

import { db } from "@src/db";
import {
  exercise,
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
