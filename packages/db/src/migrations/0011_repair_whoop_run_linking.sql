DO $$ BEGIN
  CREATE TYPE "public"."cardio_subtype" AS ENUM('running', 'cycling', 'swimming', 'rowing', 'other');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

ALTER TABLE "exercise" ADD COLUMN IF NOT EXISTS "cardio_subtype" "cardio_subtype";--> statement-breakpoint

UPDATE "exercise"
SET "cardio_subtype" = 'running'
WHERE "is_custom" = false
  AND "name" IN ('Sprint', 'Short Run', 'Long Run', 'Interval Run', 'Tempo Run', 'Recovery Run')
  AND "cardio_subtype" IS NULL;--> statement-breakpoint

ALTER TABLE "exercise_log" ADD COLUMN IF NOT EXISTS "hr_zone_durations" jsonb;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "workout_userId_whoopActivityId_unique_idx"
ON "workout" ("user_id", "whoop_activity_id")
WHERE "whoop_activity_id" IS NOT NULL;
