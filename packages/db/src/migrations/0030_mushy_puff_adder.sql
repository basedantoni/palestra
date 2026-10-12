CREATE TYPE "public"."tcg_language" AS ENUM('ja', 'en');--> statement-breakpoint
CREATE TYPE "public"."tcg_variant_kind" AS ENUM('base', 'parallel', 'manga', 'reprint');--> statement-breakpoint
CREATE TABLE "tcg_artwork" (
	"variant_id" text PRIMARY KEY NOT NULL,
	"card_number" text NOT NULL,
	"variant_kind" "tcg_variant_kind" NOT NULL,
	"artist" text,
	"artist_conflict" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcg_card" (
	"number" text PRIMARY KEY NOT NULL,
	"name_en" text,
	"name_ja" text
);
--> statement-breakpoint
CREATE TABLE "tcg_printing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" text NOT NULL,
	"language" "tcg_language" NOT NULL,
	"pack_id" text NOT NULL,
	"set_name" text NOT NULL,
	"image_url" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tcg_artwork" ADD CONSTRAINT "tcg_artwork_card_number_tcg_card_number_fk" FOREIGN KEY ("card_number") REFERENCES "public"."tcg_card"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_printing" ADD CONSTRAINT "tcg_printing_variant_id_tcg_artwork_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."tcg_artwork"("variant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tcg_artwork_cardNumber_idx" ON "tcg_artwork" USING btree ("card_number");--> statement-breakpoint
CREATE UNIQUE INDEX "tcg_printing_variantId_language_unique_idx" ON "tcg_printing" USING btree ("variant_id","language");