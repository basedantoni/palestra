DO $$ BEGIN
 CREATE TYPE "public"."distance_unit" AS ENUM('mi', 'km');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."exercise_category" AS ENUM('chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'cardio', 'other');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."muscle_group_bodybuilding" AS ENUM('chest', 'back', 'shoulders', 'arms', 'legs', 'core');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."muscle_group" AS ENUM('chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'push', 'pull', 'squat', 'hinge', 'carry');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."muscle_group_movement" AS ENUM('push', 'pull', 'squat', 'hinge', 'carry');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."muscle_group_system" AS ENUM('bodybuilding', 'movement_patterns');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."record_type" AS ENUM('max_weight', 'max_reps', 'max_volume', 'best_pace', 'longest_distance');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."theme" AS ENUM('light', 'dark', 'auto');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."trend_status" AS ENUM('improving', 'plateau', 'declining');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."weight_unit" AS ENUM('lbs', 'kg');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."workout_type" AS ENUM('weightlifting', 'hiit', 'cardio', 'calisthenics', 'yoga', 'sports', 'mixed');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" "exercise_category" NOT NULL,
	"muscle_groups_bodybuilding" "muscle_group_bodybuilding"[],
	"muscle_groups_movement" "muscle_group_movement"[],
	"exercise_type" "workout_type" NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "muscle_group_volume" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"muscle_group" "muscle_group" NOT NULL,
	"categorization_system" "muscle_group_system" NOT NULL,
	"week_start_date" date NOT NULL,
	"total_volume" real NOT NULL,
	"workout_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"exercise_id" uuid,
	"record_type" "record_type" NOT NULL,
	"value" real NOT NULL,
	"date_achieved" timestamp NOT NULL,
	"workout_id" uuid,
	"previous_record_value" real
);
--> statement-breakpoint
CREATE TABLE "progressive_overload_state" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"exercise_id" uuid NOT NULL,
	"last_10_workouts" jsonb NOT NULL,
	"trend_status" "trend_status" NOT NULL,
	"plateau_count" integer DEFAULT 0 NOT NULL,
	"next_suggested_progression" jsonb,
	"last_calculated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"workout_type" "workout_type" NOT NULL,
	"notes" text,
	"is_system_template" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"use_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_template_exercise" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workout_template_id" uuid NOT NULL,
	"exercise_id" uuid,
	"order" integer NOT NULL,
	"default_sets" integer
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"weight_unit" "weight_unit" NOT NULL,
	"distance_unit" "distance_unit" NOT NULL,
	"muscle_group_system" "muscle_group_system" NOT NULL,
	"plateau_threshold" integer DEFAULT 3 NOT NULL,
	"theme" "theme" DEFAULT 'auto' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workout_id" uuid NOT NULL,
	"exercise_id" uuid,
	"exercise_name" text NOT NULL,
	"order" integer NOT NULL,
	"rounds" integer,
	"work_duration_seconds" integer,
	"rest_duration_seconds" integer,
	"intensity" integer,
	"distance" real,
	"duration_seconds" integer,
	"pace" real,
	"heart_rate" integer,
	"duration_minutes" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_set" (
	"id" uuid PRIMARY KEY NOT NULL,
	"exercise_log_id" uuid NOT NULL,
	"set_number" integer NOT NULL,
	"reps" integer,
	"weight" real,
	"rpe" integer
);
--> statement-breakpoint
CREATE TABLE "workout" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" timestamp NOT NULL,
	"workout_type" "workout_type" NOT NULL,
	"duration_minutes" integer,
	"template_id" uuid,
	"notes" text,
	"total_volume" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise" ADD CONSTRAINT "exercise_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muscle_group_volume" ADD CONSTRAINT "muscle_group_volume_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_record" ADD CONSTRAINT "personal_record_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_record" ADD CONSTRAINT "personal_record_exercise_id_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_record" ADD CONSTRAINT "personal_record_workout_id_workout_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workout"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progressive_overload_state" ADD CONSTRAINT "progressive_overload_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progressive_overload_state" ADD CONSTRAINT "progressive_overload_state_exercise_id_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_template" ADD CONSTRAINT "workout_template_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_template_exercise" ADD CONSTRAINT "workout_template_exercise_workout_template_id_workout_template_id_fk" FOREIGN KEY ("workout_template_id") REFERENCES "public"."workout_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_template_exercise" ADD CONSTRAINT "workout_template_exercise_exercise_id_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_log" ADD CONSTRAINT "exercise_log_workout_id_workout_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workout"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_log" ADD CONSTRAINT "exercise_log_exercise_id_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_set" ADD CONSTRAINT "exercise_set_exercise_log_id_exercise_log_id_fk" FOREIGN KEY ("exercise_log_id") REFERENCES "public"."exercise_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout" ADD CONSTRAINT "workout_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout" ADD CONSTRAINT "workout_template_id_workout_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workout_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "exercise_name_idx" ON "exercise" USING btree ("name");--> statement-breakpoint
CREATE INDEX "exercise_createdByUserId_idx" ON "exercise" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "muscle_group_volume_userId_idx" ON "muscle_group_volume" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "muscle_group_volume_week_idx" ON "muscle_group_volume" USING btree ("user_id","week_start_date","categorization_system","muscle_group");--> statement-breakpoint
CREATE INDEX "personal_record_userId_idx" ON "personal_record" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "personal_record_exerciseId_idx" ON "personal_record" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "progressive_overload_state_userId_idx" ON "progressive_overload_state" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "progressive_overload_state_exerciseId_idx" ON "progressive_overload_state" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "workout_template_userId_idx" ON "workout_template" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workout_template_workoutType_idx" ON "workout_template" USING btree ("workout_type");--> statement-breakpoint
CREATE INDEX "workout_template_exercise_templateId_idx" ON "workout_template_exercise" USING btree ("workout_template_id");--> statement-breakpoint
CREATE INDEX "exercise_log_workoutId_idx" ON "exercise_log" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "exercise_log_exerciseId_idx" ON "exercise_log" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "exercise_set_exerciseLogId_idx" ON "exercise_set" USING btree ("exercise_log_id");--> statement-breakpoint
CREATE INDEX "workout_userId_idx" ON "workout" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workout_userId_date_idx" ON "workout" USING btree ("user_id","date");
