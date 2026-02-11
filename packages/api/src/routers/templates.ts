import { z } from "zod";
import { and, eq, or } from "drizzle-orm";

import { db } from "@src/db";
import {
  workoutTemplate,
  workoutTemplateExercise,
} from "@src/db/schema/index";

import { protectedProcedure, router } from "../index";

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

export const templatesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          includeSystem: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const includeSystem = input?.includeSystem ?? true;
      const whereClause = includeSystem
        ? or(
            eq(workoutTemplate.isSystemTemplate, true),
            eq(workoutTemplate.userId, ctx.session.user.id),
          )
        : eq(workoutTemplate.userId, ctx.session.user.id);

      return db
        .select()
        .from(workoutTemplate)
        .where(whereClause)
        .orderBy(workoutTemplate.name);
    }),
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.query.workoutTemplate.findFirst({
        where: (table, { and, eq, or }) =>
          and(
            eq(table.id, input.id),
            or(
              eq(table.isSystemTemplate, true),
              eq(table.userId, ctx.session.user.id),
            ),
          ),
        with: {
          exercises: true,
        },
      });
    }),
  create: protectedProcedure
    .input(templateInput)
    .mutation(async ({ ctx, input }) => {
      return db.transaction(async (tx) => {
        const [createdTemplate] = await tx
          .insert(workoutTemplate)
          .values({
            userId: ctx.session.user.id,
            name: input.name,
            workoutType: input.workoutType,
            notes: input.notes,
            isSystemTemplate: false,
          })
          .returning();

        if (input.exercises.length) {
          await tx.insert(workoutTemplateExercise).values(
            input.exercises.map((exerciseInput) => ({
              workoutTemplateId: createdTemplate.id,
              exerciseId: exerciseInput.exerciseId,
              order: exerciseInput.order,
              defaultSets: exerciseInput.defaultSets,
            })),
          );
        }

        return createdTemplate;
      });
    }),
  update: protectedProcedure
    .input(templateInput.extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
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
              eq(workoutTemplate.userId, ctx.session.user.id),
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
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await db
        .delete(workoutTemplate)
        .where(
          and(
            eq(workoutTemplate.id, input.id),
            eq(workoutTemplate.userId, ctx.session.user.id),
          ),
        )
        .returning();
      return deleted ?? null;
    }),
});
