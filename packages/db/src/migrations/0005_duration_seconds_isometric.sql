ALTER TABLE "exercise_set" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TYPE "muscle_group_movement" ADD VALUE 'isometric';--> statement-breakpoint
ALTER TYPE "muscle_group" ADD VALUE 'isometric';
