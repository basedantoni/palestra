CREATE TYPE "public"."custom_exercise_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('custom_exercise_approved', 'custom_exercise_rejected');--> statement-breakpoint
ALTER TYPE "public"."muscle_group" ADD VALUE 'isometric';--> statement-breakpoint
ALTER TYPE "public"."muscle_group_movement" ADD VALUE 'isometric';--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"payload" jsonb,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise" ADD COLUMN "linked_exercise_id" uuid;--> statement-breakpoint
ALTER TABLE "exercise" ADD COLUMN "status" "custom_exercise_status";--> statement-breakpoint
ALTER TABLE "exercise" ADD COLUMN "rejected_reason" text;--> statement-breakpoint
ALTER TABLE "exercise" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "exercise" ADD COLUMN "approved_by_user_id" text;--> statement-breakpoint
ALTER TABLE "exercise_set" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_userId_idx" ON "notification" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_userId_readAt_idx" ON "notification" USING btree ("user_id","read_at");--> statement-breakpoint
ALTER TABLE "exercise" ADD CONSTRAINT "exercise_linked_exercise_id_exercise_id_fk" FOREIGN KEY ("linked_exercise_id") REFERENCES "public"."exercise"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise" ADD CONSTRAINT "exercise_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_status_idx" ON "exercise" USING btree ("status");--> statement-breakpoint
UPDATE "exercise" SET "status" = 'approved' WHERE "is_custom" = true AND "status" IS NULL;