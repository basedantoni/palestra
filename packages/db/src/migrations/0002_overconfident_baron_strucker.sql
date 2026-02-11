CREATE TYPE "public"."experience_level" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."fitness_goal" AS ENUM('build_muscle', 'lose_fat', 'increase_strength', 'improve_endurance', 'general_fitness', 'flexibility');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'other', 'prefer_not_to_say');--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "fitness_goal" "fitness_goal";--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "experience_level" "experience_level";--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "preferred_workout_types" text;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "gender" "gender";--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "birth_year" integer;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "height_cm" integer;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "weight_kg" integer;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "onboarding_completed" boolean DEFAULT false NOT NULL;