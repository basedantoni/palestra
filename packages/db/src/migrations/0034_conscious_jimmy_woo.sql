CREATE TABLE "tcg_offer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"want_id" uuid NOT NULL,
	"printing_id" uuid NOT NULL,
	"seller" text NOT NULL,
	"price" real NOT NULL,
	"url" text,
	"seen_on" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tcg_offer" ADD CONSTRAINT "tcg_offer_want_id_tcg_want_id_fk" FOREIGN KEY ("want_id") REFERENCES "public"."tcg_want"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_offer" ADD CONSTRAINT "tcg_offer_printing_id_tcg_printing_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."tcg_printing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tcg_offer_wantId_idx" ON "tcg_offer" USING btree ("want_id");