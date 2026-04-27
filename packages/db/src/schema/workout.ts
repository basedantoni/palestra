import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { workoutTypeEnum } from "./enums";
import { user } from "./auth";
import { exercise } from "./exercise";
import { workoutTemplate } from "./template";

export const workout = pgTable(
  "workout",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: timestamp("date").notNull(),
    workoutType: workoutTypeEnum("workout_type").notNull(),
    durationMinutes: integer("duration_minutes"),
    templateId: uuid("template_id").references(() => workoutTemplate.id),
    notes: text("notes"),
    totalVolume: real("total_volume"),
    source: text("source"),
    whoopActivityId: text("whoop_activity_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("workout_userId_idx").on(table.userId),
    index("workout_userId_date_idx").on(table.userId, table.date),
    index("workout_whoopActivityId_idx").on(table.whoopActivityId),
  ],
);

export const exerciseLog = pgTable(
  "exercise_log",
  {
    id: uuid("id").primaryKey(),
    workoutId: uuid("workout_id")
      .notNull()
      .references(() => workout.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id").references(() => exercise.id),
    exerciseName: text("exercise_name").notNull(),
    order: integer("order").notNull(),
    rounds: integer("rounds"),
    workDurationSeconds: integer("work_duration_seconds"),
    restDurationSeconds: integer("rest_duration_seconds"),
    intensity: integer("intensity"),
    distance: real("distance"),
    durationSeconds: integer("duration_seconds"),
    pace: real("pace"),
    heartRate: integer("heart_rate"),
    durationMinutes: integer("duration_minutes"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("exercise_log_workoutId_idx").on(table.workoutId),
    index("exercise_log_exerciseId_idx").on(table.exerciseId),
  ],
);

export const exerciseSet = pgTable(
  "exercise_set",
  {
    id: uuid("id").primaryKey(),
    exerciseLogId: uuid("exercise_log_id")
      .notNull()
      .references(() => exerciseLog.id, { onDelete: "cascade" }),
    setNumber: integer("set_number").notNull(),
    reps: integer("reps"),
    weight: real("weight"),
    rpe: integer("rpe"),
    durationSeconds: integer("duration_seconds"),
  },
  (table) => [index("exercise_set_exerciseLogId_idx").on(table.exerciseLogId)],
);

export const workoutRelations = relations(workout, ({ many, one }) => ({
  user: one(user, {
    fields: [workout.userId],
    references: [user.id],
  }),
  template: one(workoutTemplate, {
    fields: [workout.templateId],
    references: [workoutTemplate.id],
  }),
  logs: many(exerciseLog),
}));

export const exerciseLogRelations = relations(exerciseLog, ({ many, one }) => ({
  workout: one(workout, {
    fields: [exerciseLog.workoutId],
    references: [workout.id],
  }),
  exercise: one(exercise, {
    fields: [exerciseLog.exerciseId],
    references: [exercise.id],
  }),
  sets: many(exerciseSet),
}));

export const exerciseSetRelations = relations(exerciseSet, ({ one }) => ({
  log: one(exerciseLog, {
    fields: [exerciseSet.exerciseLogId],
    references: [exerciseLog.id],
  }),
}));
