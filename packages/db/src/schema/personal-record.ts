import { relations } from "drizzle-orm";
import {
  index,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { recordTypeEnum } from "./enums";
import { user } from "./auth";
import { exercise } from "./exercise";
import { workout } from "./workout";

export const personalRecord = pgTable(
  "personal_record",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id").references(() => exercise.id),
    recordType: recordTypeEnum("record_type").notNull(),
    value: real("value").notNull(),
    dateAchieved: timestamp("date_achieved").notNull(),
    workoutId: uuid("workout_id").references(() => workout.id),
    previousRecordValue: real("previous_record_value"),
  },
  (table) => [
    index("personal_record_userId_idx").on(table.userId),
    index("personal_record_exerciseId_idx").on(table.exerciseId),
  ],
);

export const personalRecordRelations = relations(personalRecord, ({ one }) => ({
  user: one(user, {
    fields: [personalRecord.userId],
    references: [user.id],
  }),
  exercise: one(exercise, {
    fields: [personalRecord.exerciseId],
    references: [exercise.id],
  }),
  workout: one(workout, {
    fields: [personalRecord.workoutId],
    references: [workout.id],
  }),
}));
