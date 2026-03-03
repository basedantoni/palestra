import { preferencesInputSchema } from "@src/shared";

import { db } from "@src/db";
import { userPreferences } from "@src/db/schema/index";

import { protectedProcedure, router } from "../index";

export const preferencesRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    return db.query.userPreferences.findFirst({
      where: (table, { eq }) => eq(table.userId, ctx.session.user.id),
    });
  }),

  isOnboardingComplete: protectedProcedure.query(async ({ ctx }) => {
    const prefs = await db.query.userPreferences.findFirst({
      where: (table, { eq }) => eq(table.userId, ctx.session.user.id),
      columns: { onboardingCompleted: true },
    });
    return prefs?.onboardingCompleted ?? false;
  }),

  upsert: protectedProcedure
    .input(preferencesInputSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const { preferredWorkoutTypes, ...rest } = input;
      const dbInput = {
        ...rest,
        preferredWorkoutTypes: preferredWorkoutTypes
          ? JSON.stringify(preferredWorkoutTypes)
          : undefined,
      };
      const [result] = await db
        .insert(userPreferences)
        .values({
          userId: ctx.session.user.id,
          ...dbInput,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: userPreferences.userId,
          set: {
            ...dbInput,
            updatedAt: now,
          },
        })
        .returning();
      return result;
    }),
});
