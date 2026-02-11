import { z } from "zod";

import { db } from "@src/db";
import { userPreferences } from "@src/db/schema/index";

import { protectedProcedure, router } from "../index";

const preferencesInput = z.object({
  weightUnit: z.enum(["lbs", "kg"]),
  distanceUnit: z.enum(["mi", "km"]),
  muscleGroupSystem: z.enum(["bodybuilding", "movement_patterns"]),
  plateauThreshold: z.number().int().min(1).max(20),
  theme: z.enum(["light", "dark", "auto"]),
  // New onboarding fields (all optional so existing callers don't break)
  fitnessGoal: z.enum([
    "build_muscle", "lose_fat", "increase_strength",
    "improve_endurance", "general_fitness", "flexibility",
  ]).optional(),
  experienceLevel: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  preferredWorkoutTypes: z.array(
    z.enum(["weightlifting", "hiit", "cardio", "calisthenics", "yoga", "sports"])
  ).optional(),
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).optional(),
  birthYear: z.number().int().min(1920).max(2020).optional(),
  heightCm: z.number().int().min(50).max(300).optional(),
  weightKg: z.number().int().min(20).max(500).optional(),
  onboardingCompleted: z.boolean().optional(),
});

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
    .input(preferencesInput)
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
