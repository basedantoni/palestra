import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  exerciseCategoryEnum,
  muscleGroupBodybuildingEnum,
  muscleGroupMovementEnum,
  workoutTypeEnum,
} from "./enums";
import { user } from "./auth";
import { exerciseLog } from "./workout";
import { workoutTemplateExercise } from "./template";
import { personalRecord } from "./personal-record";
import { progressiveOverloadState } from "./progressive-overload";

export const exercise = pgTable(
  "exercise",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    category: exerciseCategoryEnum("category").notNull(),
    muscleGroupsBodybuilding: muscleGroupBodybuildingEnum(
      "muscle_groups_bodybuilding",
    ).array(),
    muscleGroupsMovement: muscleGroupMovementEnum(
      "muscle_groups_movement",
    ).array(),
    exerciseType: workoutTypeEnum("exercise_type").notNull(),
    isCustom: boolean("is_custom").default(false).notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("exercise_name_idx").on(table.name),
    index("exercise_createdByUserId_idx").on(table.createdByUserId),
  ],
);

export const exerciseRelations = relations(exercise, ({ many, one }) => ({
  createdByUser: one(user, {
    fields: [exercise.createdByUserId],
    references: [user.id],
  }),
  logs: many(exerciseLog),
  templateExercises: many(workoutTemplateExercise),
  personalRecords: many(personalRecord),
  overloadStates: many(progressiveOverloadState),
}));
