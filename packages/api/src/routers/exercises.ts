import { z } from "zod";
import { and, eq, or } from "drizzle-orm";

import { db } from "@src/db";
import { exercise } from "@src/db/schema/index";

import { protectedProcedure, router } from "../index";

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

export const exercisesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          includeCustom: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const includeCustom = input?.includeCustom ?? true;
      if (!includeCustom) {
        return db
          .select()
          .from(exercise)
          .where(eq(exercise.isCustom, false))
          .orderBy(exercise.name);
      }
      return db
        .select()
        .from(exercise)
        .where(
          or(
            eq(exercise.isCustom, false),
            eq(exercise.createdByUserId, ctx.session.user.id),
          ),
        )
        .orderBy(exercise.name);
    }),
  createCustom: protectedProcedure
    .input(exerciseInput)
    .mutation(async ({ ctx, input }) => {
      const [created] = await db
        .insert(exercise)
        .values({
          name: input.name,
          category: input.category,
          muscleGroupsBodybuilding: input.muscleGroupsBodybuilding,
          muscleGroupsMovement: input.muscleGroupsMovement,
          exerciseType: input.exerciseType,
          isCustom: true,
          createdByUserId: ctx.session.user.id,
        })
        .returning();
      return created;
    }),
  updateCustom: protectedProcedure
    .input(
      exerciseInput.extend({
        id: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(exercise)
        .set({
          name: input.name,
          category: input.category,
          muscleGroupsBodybuilding: input.muscleGroupsBodybuilding,
          muscleGroupsMovement: input.muscleGroupsMovement,
          exerciseType: input.exerciseType,
        })
        .where(
          and(
            eq(exercise.id, input.id),
            eq(exercise.createdByUserId, ctx.session.user.id),
            eq(exercise.isCustom, true),
          ),
        )
        .returning();
      return updated ?? null;
    }),
  deleteCustom: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await db
        .delete(exercise)
        .where(
          and(
            eq(exercise.id, input.id),
            eq(exercise.createdByUserId, ctx.session.user.id),
            eq(exercise.isCustom, true),
          ),
        )
        .returning();
      return deleted ?? null;
    }),
});
