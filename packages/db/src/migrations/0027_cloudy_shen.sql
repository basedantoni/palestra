CREATE TABLE "category_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"pattern" text NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "category_rule" ADD CONSTRAINT "category_rule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rule" ADD CONSTRAINT "category_rule_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_rule_userId_pattern_unique_idx" ON "category_rule" USING btree ("user_id",lower("pattern"));