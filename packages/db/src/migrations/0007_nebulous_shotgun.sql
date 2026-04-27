CREATE TABLE "whoop_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expires_at" timestamp NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"last_imported_at" timestamp,
	"is_valid" boolean DEFAULT true NOT NULL,
	CONSTRAINT "whoop_connection_userId_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "workout" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "workout" ADD COLUMN "whoop_activity_id" text;--> statement-breakpoint
ALTER TABLE "whoop_connection" ADD CONSTRAINT "whoop_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whoop_connection_userId_idx" ON "whoop_connection" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workout_whoopActivityId_idx" ON "workout" USING btree ("whoop_activity_id");