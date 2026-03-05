import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { trendStatusEnum } from "./enums";
import { user } from "./auth";
import { exercise } from "./exercise";

export const progressiveOverloadState = pgTable(
  "progressive_overload_state",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercise.id),
    last10Workouts: jsonb("last_10_workouts").notNull(),
    trendStatus: trendStatusEnum("trend_status").notNull(),
    plateauCount: integer("plateau_count").default(0).notNull(),
    nextSuggestedProgression: jsonb("next_suggested_progression"),
    lastCalculatedAt: timestamp("last_calculated_at").notNull(),
  },
  (table) => [
    index("progressive_overload_state_userId_idx").on(table.userId),
    index("progressive_overload_state_exerciseId_idx").on(table.exerciseId),
    uniqueIndex("progressive_overload_state_user_exercise_uq").on(
      table.userId,
      table.exerciseId,
    ),
  ],
);

export const progressiveOverloadStateRelations = relations(
  progressiveOverloadState,
  ({ one }) => ({
    user: one(user, {
      fields: [progressiveOverloadState.userId],
      references: [user.id],
    }),
    exercise: one(exercise, {
      fields: [progressiveOverloadState.exerciseId],
      references: [exercise.id],
    }),
  }),
);
