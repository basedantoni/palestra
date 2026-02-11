import { relations } from "drizzle-orm";
import {
  date,
  index,
  integer,
  pgTable,
  real,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { muscleGroupEnum, muscleGroupSystemEnum } from "./enums";
import { user } from "./auth";

export const muscleGroupVolume = pgTable(
  "muscle_group_volume",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    muscleGroup: muscleGroupEnum("muscle_group").notNull(),
    categorizationSystem: muscleGroupSystemEnum("categorization_system").notNull(),
    weekStartDate: date("week_start_date").notNull(),
    totalVolume: real("total_volume").notNull(),
    workoutCount: integer("workout_count").default(0).notNull(),
  },
  (table) => [
    index("muscle_group_volume_userId_idx").on(table.userId),
    index("muscle_group_volume_week_idx").on(
      table.userId,
      table.weekStartDate,
      table.categorizationSystem,
      table.muscleGroup,
    ),
  ],
);

export const muscleGroupVolumeRelations = relations(
  muscleGroupVolume,
  ({ one }) => ({
    user: one(user, {
      fields: [muscleGroupVolume.userId],
      references: [user.id],
    }),
  }),
);
