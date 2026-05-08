import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const whoopConnection = pgTable(
  "whoop_connection",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    tokenExpiresAt: timestamp("token_expires_at").notNull(),
    connectedAt: timestamp("connected_at").defaultNow().notNull(),
    lastImportedAt: timestamp("last_imported_at"),
    isValid: boolean("is_valid").default(true).notNull(),
    // Phase 1: webhook support
    whoopUserId: text("whoop_user_id"),
    webhookSubscriptionId: text("webhook_subscription_id"),
    webhookSecret: text("webhook_secret"),
    webhookLastReceivedAt: timestamp("webhook_last_received_at"),
    autoImportEnabled: boolean("auto_import_enabled").default(true).notNull(),
    notifyOnAutoImport: boolean("notify_on_auto_import").default(true).notNull(),
  },
  (table) => [
    unique("whoop_connection_userId_unique").on(table.userId),
    index("whoop_connection_userId_idx").on(table.userId),
    index("whoop_connection_whoopUserId_idx").on(table.whoopUserId),
  ],
);

export const whoopConnectionRelations = relations(whoopConnection, ({ one }) => ({
  user: one(user, {
    fields: [whoopConnection.userId],
    references: [user.id],
  }),
}));

export const whoopWebhookEvent = pgTable(
  "whoop_webhook_event",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    whoopResourceId: text("whoop_resource_id"),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
    status: text("status").notNull(),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("whoop_webhook_event_userId_receivedAt_idx").on(table.userId, table.receivedAt),
  ],
);

export const whoopWebhookEventRelations = relations(whoopWebhookEvent, ({ one }) => ({
  user: one(user, {
    fields: [whoopWebhookEvent.userId],
    references: [user.id],
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Phase 7: whoop_sleep — one row per Whoop sleep session
// ─────────────────────────────────────────────────────────────────────────────

export const whoopSleep = pgTable(
  "whoop_sleep",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    whoopSleepId: text("whoop_sleep_id").notNull(),
    start: timestamp("start").notNull(),
    end: timestamp("end").notNull(),
    nap: boolean("nap").notNull().default(false),
    scoreState: text("score_state"), // "SCORED" | "PENDING_SCORE" | "INCOMPLETE" | null
    // Sleep score percentages (0–100)
    performancePct: real("performance_pct"),
    consistencyPct: real("consistency_pct"),
    efficiencyPct: real("efficiency_pct"),
    // Physiological metrics
    respiratoryRate: real("respiratory_rate"),
    // Stage summary (milliseconds)
    totalInBedMilli: integer("total_in_bed_milli"),
    totalAwakeMilli: integer("total_awake_milli"),
    lightSleepMilli: integer("light_sleep_milli"),
    slowWaveMilli: integer("slow_wave_milli"),
    remMilli: integer("rem_milli"),
    noDataMilli: integer("no_data_milli"),
    disturbanceCount: integer("disturbance_count"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Partial unique index on (userId, whoopSleepId) — enforces one row per sleep session per user
    uniqueIndex("whoop_sleep_userId_whoopSleepId_unique_idx")
      .on(table.userId, table.whoopSleepId)
      .where(sql`${table.whoopSleepId} IS NOT NULL`),
    // Index for chronological listing
    index("whoop_sleep_userId_createdAt_idx").on(table.userId, table.createdAt),
  ],
);

export const whoopSleepRelations = relations(whoopSleep, ({ one }) => ({
  user: one(user, {
    fields: [whoopSleep.userId],
    references: [user.id],
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8: whoop_recovery — one row per Whoop recovery, keyed by (userId, whoopCycleId)
// ─────────────────────────────────────────────────────────────────────────────

export const whoopRecovery = pgTable(
  "whoop_recovery",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    whoopCycleId: text("whoop_cycle_id").notNull(),
    // Plain text — NOT a FK to avoid race condition when sleep row hasn't arrived yet
    whoopSleepId: text("whoop_sleep_id"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    scoreState: text("score_state"), // "SCORED" | "PENDING_SCORE" | "INCOMPLETE" | null
    // Recovery score 0–100
    recoveryScore: integer("recovery_score"),
    // Physiological metrics
    restingHr: real("resting_hr"),
    hrv: real("hrv"),           // RMSSD ms
    spo2Pct: real("spo2_pct"),  // 0–100
    skinTempCelsius: real("skin_temp_celsius"),
    userCalibrating: boolean("user_calibrating").notNull().default(false),
  },
  (table) => [
    // Partial unique index on (userId, whoopCycleId) where whoopCycleId IS NOT NULL
    uniqueIndex("whoop_recovery_userId_whoopCycleId_unique_idx")
      .on(table.userId, table.whoopCycleId)
      .where(sql`${table.whoopCycleId} IS NOT NULL`),
    // Index for chronological listing
    index("whoop_recovery_userId_createdAt_idx").on(table.userId, table.createdAt),
  ],
);

export const whoopRecoveryRelations = relations(whoopRecovery, ({ one }) => ({
  user: one(user, {
    fields: [whoopRecovery.userId],
    references: [user.id],
  }),
}));
