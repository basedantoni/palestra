-- Phase 7: Add whoop_sleep table
CREATE TABLE "whoop_sleep" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"whoop_sleep_id" text NOT NULL,
	"start" timestamp NOT NULL,
	"end" timestamp NOT NULL,
	"nap" boolean DEFAULT false NOT NULL,
	"score_state" text,
	"performance_pct" real,
	"consistency_pct" real,
	"efficiency_pct" real,
	"respiratory_rate" real,
	"total_in_bed_milli" integer,
	"total_awake_milli" integer,
	"light_sleep_milli" integer,
	"slow_wave_milli" integer,
	"rem_milli" integer,
	"no_data_milli" integer,
	"disturbance_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whoop_sleep_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE
);--> statement-breakpoint
-- Partial unique index on (userId, whoopSleepId) where whoopSleepId IS NOT NULL
CREATE UNIQUE INDEX "whoop_sleep_userId_whoopSleepId_unique_idx" ON "whoop_sleep" ("user_id", "whoop_sleep_id") WHERE "whoop_sleep_id" IS NOT NULL;--> statement-breakpoint
-- Index for chronological listing
CREATE INDEX "whoop_sleep_userId_createdAt_idx" ON "whoop_sleep" ("user_id", "created_at");
