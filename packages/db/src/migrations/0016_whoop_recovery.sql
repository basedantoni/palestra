-- Phase 8: Add whoop_recovery table
CREATE TABLE "whoop_recovery" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"whoop_cycle_id" text NOT NULL,
	"whoop_sleep_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"score_state" text,
	"recovery_score" integer,
	"resting_hr" real,
	"hrv" real,
	"spo2_pct" real,
	"skin_temp_celsius" real,
	"user_calibrating" boolean DEFAULT false NOT NULL,
	CONSTRAINT "whoop_recovery_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE
);--> statement-breakpoint
-- Partial unique index on (userId, whoopCycleId) where whoopCycleId IS NOT NULL
CREATE UNIQUE INDEX "whoop_recovery_userId_whoopCycleId_unique_idx" ON "whoop_recovery" ("user_id", "whoop_cycle_id") WHERE "whoop_cycle_id" IS NOT NULL;--> statement-breakpoint
-- Index for chronological listing
CREATE INDEX "whoop_recovery_userId_createdAt_idx" ON "whoop_recovery" ("user_id", "created_at");
