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
  customExerciseStatusEnum,
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
    linkedExerciseId: uuid("linked_exercise_id").references(
      (): any => exercise.id,
      { onDelete: "set null" },
    ),
    status: customExerciseStatusEnum("status"),
    rejectedReason: text("rejected_reason"),
    approvedAt: timestamp("approved_at"),
    approvedByUserId: text("approved_by_user_id").references(() => user.id),
  },
  (table) => [
    index("exercise_name_idx").on(table.name),
    index("exercise_createdByUserId_idx").on(table.createdByUserId),
    index("exercise_status_idx").on(table.status),
  ],
);

export const exerciseRelations = relations(exercise, ({ many, one }) => ({
  createdByUser: one(user, {
    fields: [exercise.createdByUserId],
    references: [user.id],
  }),
  linkedExercise: one(exercise, {
    fields: [exercise.linkedExerciseId],
    references: [exercise.id],
    relationName: "linkedExercise",
  }),
  linkedChildren: many(exercise, { relationName: "linkedExercise" }),
  logs: many(exerciseLog),
  templateExercises: many(workoutTemplateExercise),
  personalRecords: many(personalRecord),
  overloadStates: many(progressiveOverloadState),
}));
