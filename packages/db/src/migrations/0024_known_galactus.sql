CREATE TABLE "plaid_webhook_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"webhook_type" text NOT NULL,
	"webhook_code" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE INDEX "plaid_webhook_event_itemId_idx" ON "plaid_webhook_event" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "plaid_webhook_event_status_idx" ON "plaid_webhook_event" USING btree ("status");