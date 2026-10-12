CREATE TABLE "tcg_copy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"printing_id" uuid NOT NULL,
	"condition" "tcg_condition" NOT NULL,
	"price_paid" real,
	"acquired_on" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tcg_copy" ADD CONSTRAINT "tcg_copy_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_copy" ADD CONSTRAINT "tcg_copy_printing_id_tcg_printing_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."tcg_printing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tcg_copy_userId_idx" ON "tcg_copy" USING btree ("user_id");