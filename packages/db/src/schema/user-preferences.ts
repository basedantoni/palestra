import { relations } from "drizzle-orm";
import { boolean, integer, timestamp, text, pgTable } from "drizzle-orm/pg-core";

import {
  distanceUnitEnum,
  experienceLevelEnum,
  fitnessGoalEnum,
  genderEnum,
  muscleGroupSystemEnum,
  themeEnum,
  weightUnitEnum,
} from "./enums";
import { user } from "./auth";

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  weightUnit: weightUnitEnum("weight_unit").notNull(),
  distanceUnit: distanceUnitEnum("distance_unit").notNull(),
  muscleGroupSystem: muscleGroupSystemEnum("muscle_group_system").notNull(),
  plateauThreshold: integer("plateau_threshold").default(3).notNull(),
  theme: themeEnum("theme").default("auto").notNull(),
  // Onboarding fields
  fitnessGoal: fitnessGoalEnum("fitness_goal"),
  experienceLevel: experienceLevelEnum("experience_level"),
  preferredWorkoutTypes: text("preferred_workout_types"), // JSON array stored as text
  gender: genderEnum("gender"),
  birthYear: integer("birth_year"),
  heightCm: integer("height_cm"),
  weightKg: integer("weight_kg"),
  onboardingCompleted: boolean("onboarding_completed").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
  user: one(user, {
    fields: [userPreferences.userId],
    references: [user.id],
  }),
}));
