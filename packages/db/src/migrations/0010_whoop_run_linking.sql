-- Add cardioSubtype enum
CREATE TYPE "public"."cardio_subtype" AS ENUM('running', 'cycling', 'swimming', 'rowing', 'other');--> statement-breakpoint
-- Add cardioSubtype column to exercise table (nullable)
ALTER TABLE "exercise" ADD COLUMN "cardio_subtype" "cardio_subtype";--> statement-breakpoint
-- Backfill system running exercises with 'running'
UPDATE "exercise"
SET "cardio_subtype" = 'running'
WHERE "is_custom" = false
  AND "name" IN ('Sprint', 'Short Run', 'Long Run', 'Interval Run', 'Tempo Run', 'Recovery Run');--> statement-breakpoint
-- Add hr_zone_durations jsonb column to exercise_log table (nullable)
ALTER TABLE "exercise_log" ADD COLUMN "hr_zone_durations" jsonb;--> statement-breakpoint
-- Add unique index on workout(user_id, whoop_activity_id) where whoop_activity_id is not null
CREATE UNIQUE INDEX "workout_userId_whoopActivityId_unique_idx" ON "workout" ("user_id", "whoop_activity_id") WHERE "whoop_activity_id" IS NOT NULL;
