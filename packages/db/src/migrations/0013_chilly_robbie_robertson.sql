CREATE TABLE "whoop_webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"whoop_resource_id" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"status" text NOT NULL,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "whoop_connection" ADD COLUMN "whoop_user_id" text;--> statement-breakpoint
ALTER TABLE "whoop_connection" ADD COLUMN "webhook_subscription_id" text;--> statement-breakpoint
ALTER TABLE "whoop_connection" ADD COLUMN "webhook_secret" text;--> statement-breakpoint
ALTER TABLE "whoop_connection" ADD COLUMN "webhook_last_received_at" timestamp;--> statement-breakpoint
ALTER TABLE "whoop_connection" ADD COLUMN "auto_import_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "whoop_connection" ADD COLUMN "notify_on_auto_import" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "whoop_webhook_event" ADD CONSTRAINT "whoop_webhook_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whoop_webhook_event_userId_receivedAt_idx" ON "whoop_webhook_event" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE INDEX "whoop_connection_whoopUserId_idx" ON "whoop_connection" USING btree ("whoop_user_id");
