ALTER TABLE "exercise_log" ADD COLUMN IF NOT EXISTS "rounds" integer;--> statement-breakpoint
ALTER TABLE "exercise_log" ADD COLUMN IF NOT EXISTS "work_duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "exercise_log" ADD COLUMN IF NOT EXISTS "rest_duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "exercise_log" ADD COLUMN IF NOT EXISTS "intensity" integer;--> statement-breakpoint
ALTER TABLE "exercise_log" ADD COLUMN IF NOT EXISTS "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "exercise_log" ADD COLUMN IF NOT EXISTS "heart_rate" integer;--> statement-breakpoint
ALTER TABLE "exercise_log" ADD COLUMN IF NOT EXISTS "duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "exercise_log" ADD COLUMN IF NOT EXISTS "notes" text;--> statement-breakpoint
ALTER TABLE "exercise_log" ADD COLUMN IF NOT EXISTS "hr_zone_durations" jsonb;--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'exercise_log'
      AND column_name = 'distance_meter'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'exercise_log'
        AND column_name = 'distance'
    ) THEN
      ALTER TABLE "exercise_log" RENAME COLUMN "distance" TO "distance_meter";
      UPDATE "exercise_log"
      SET "distance_meter" = "distance_meter" * 1609.344
      WHERE "distance_meter" IS NOT NULL;
    ELSE
      ALTER TABLE "exercise_log" ADD COLUMN "distance_meter" real;
    END IF;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "exercise_log" DROP COLUMN IF EXISTS "pace";--> statement-breakpoint
ALTER TABLE "exercise_set" ADD COLUMN IF NOT EXISTS "duration_seconds" integer;
