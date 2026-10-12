CREATE TABLE "tcg_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"cards_category_id" uuid,
	"start_month" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tcg_settings" ADD CONSTRAINT "tcg_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_settings" ADD CONSTRAINT "tcg_settings_cards_category_id_category_id_fk" FOREIGN KEY ("cards_category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;