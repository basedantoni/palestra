CREATE TYPE "public"."tcg_condition" AS ENUM('NM', 'LP', 'MP', 'HP', 'DMG');--> statement-breakpoint
CREATE TYPE "public"."tcg_want_status" AS ENUM('open', 'ordered', 'fulfilled', 'dropped');--> statement-breakpoint
CREATE TABLE "tcg_want" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"languages" "tcg_language"[] NOT NULL,
	"max_price" real NOT NULL,
	"min_condition" "tcg_condition" NOT NULL,
	"status" "tcg_want_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tcg_want" ADD CONSTRAINT "tcg_want_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_want" ADD CONSTRAINT "tcg_want_variant_id_tcg_artwork_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."tcg_artwork"("variant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tcg_want_userId_status_idx" ON "tcg_want" USING btree ("user_id","status");