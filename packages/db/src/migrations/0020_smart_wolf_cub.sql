CREATE TYPE "public"."recalc_job_kind" AS ENUM('progressive_overload', 'muscle_group_volume');--> statement-breakpoint
CREATE TYPE "public"."recalc_job_status" AS ENUM('pending', 'processing', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "recalc_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" "recalc_job_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "recalc_job_status" DEFAULT 'pending' NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "recalc_job" ADD CONSTRAINT "recalc_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recalc_job_status_receivedAt_idx" ON "recalc_job" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "recalc_job_userId_idx" ON "recalc_job" USING btree ("user_id");