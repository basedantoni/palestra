-- Rename distance → distance_meter and convert existing mile values to meters
ALTER TABLE "exercise_log" RENAME COLUMN "distance" TO "distance_meter";--> statement-breakpoint
-- Multiply existing non-null values by 1609.344 (miles → meters)
UPDATE "exercise_log" SET "distance_meter" = "distance_meter" * 1609.344 WHERE "distance_meter" IS NOT NULL;--> statement-breakpoint
-- Drop pace column (pace is derived at display time from distance_meter ÷ duration_seconds)
ALTER TABLE "exercise_log" DROP COLUMN "pace";
