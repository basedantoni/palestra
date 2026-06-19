import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { recalcJobKindEnum, recalcJobStatusEnum } from "./enums";
import { user } from "./auth";

/**
 * Durable queue of analytics recalculation jobs.
 *
 * Mirrors the whoop_webhook_event pattern: each workout write enqueues rows
 * here instead of firing recalcs fire-and-forget. A failed recalc stays
 * visible (status='failed' + errorMessage) and is retried by the startup
 * drain. Jobs are idempotent recomputes, so at-least-once delivery is safe.
 */
export const recalcJob = pgTable(
  "recalc_job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: recalcJobKindEnum("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: recalcJobStatusEnum("status").notNull().default("pending"),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("recalc_job_status_receivedAt_idx").on(
      table.status,
      table.receivedAt,
    ),
    index("recalc_job_userId_idx").on(table.userId),
  ],
);

export const recalcJobRelations = relations(recalcJob, ({ one }) => ({
  user: one(user, {
    fields: [recalcJob.userId],
    references: [user.id],
  }),
}));
