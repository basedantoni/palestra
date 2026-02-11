import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { workoutTypeEnum } from "./enums";
import { user } from "./auth";
import { exercise } from "./exercise";
import { workout } from "./workout";

export const workoutTemplate = pgTable(
  "workout_template",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    workoutType: workoutTypeEnum("workout_type").notNull(),
    notes: text("notes"),
    isSystemTemplate: boolean("is_system_template").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at"),
    useCount: integer("use_count").default(0).notNull(),
  },
  (table) => [
    index("workout_template_userId_idx").on(table.userId),
    index("workout_template_workoutType_idx").on(table.workoutType),
  ],
);

export const workoutTemplateExercise = pgTable(
  "workout_template_exercise",
  {
    id: uuid("id").primaryKey(),
    workoutTemplateId: uuid("workout_template_id")
      .notNull()
      .references(() => workoutTemplate.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id").references(() => exercise.id),
    order: integer("order").notNull(),
    defaultSets: integer("default_sets"),
  },
  (table) => [
    index("workout_template_exercise_templateId_idx").on(
      table.workoutTemplateId,
    ),
  ],
);

export const workoutTemplateRelations = relations(
  workoutTemplate,
  ({ many, one }) => ({
    user: one(user, {
      fields: [workoutTemplate.userId],
      references: [user.id],
    }),
    exercises: many(workoutTemplateExercise),
    workouts: many(workout),
  }),
);

export const workoutTemplateExerciseRelations = relations(
  workoutTemplateExercise,
  ({ one }) => ({
    template: one(workoutTemplate, {
      fields: [workoutTemplateExercise.workoutTemplateId],
      references: [workoutTemplate.id],
    }),
    exercise: one(exercise, {
      fields: [workoutTemplateExercise.exerciseId],
      references: [exercise.id],
    }),
  }),
);
