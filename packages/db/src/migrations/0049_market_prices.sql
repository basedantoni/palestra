CREATE TYPE "public"."tcg_marketplace" AS ENUM('tcgplayer', 'cardtrader');--> statement-breakpoint
CREATE TYPE "public"."tcg_match_method" AS ENUM('rule', 'tcgplayer_id', 'typesafe', 'manual');--> statement-breakpoint
CREATE TABLE "tcg_market_price" (
	"printing_id" uuid NOT NULL,
	"marketplace" "tcg_marketplace" NOT NULL,
	"condition" "tcg_condition" NOT NULL,
	"day" date NOT NULL,
	"price" real NOT NULL,
	"listing_count" integer,
	"marketplace_product_id" integer NOT NULL,
	CONSTRAINT "tcg_market_price_printing_id_marketplace_condition_day_pk" PRIMARY KEY("printing_id","marketplace","condition","day")
);
--> statement-breakpoint
CREATE TABLE "tcg_marketplace_product" (
	"id" serial PRIMARY KEY NOT NULL,
	"marketplace" "tcg_marketplace" NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"number" text NOT NULL,
	"set" text NOT NULL,
	"variant_id" text,
	"method" "tcg_match_method" NOT NULL,
	"confidence" real,
	"reason" text,
	"matched_at" timestamp,
	"last_seen_on" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tcg_market_price" ADD CONSTRAINT "tcg_market_price_printing_id_tcg_printing_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."tcg_printing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_market_price" ADD CONSTRAINT "tcg_market_price_marketplace_product_id_tcg_marketplace_product_id_fk" FOREIGN KEY ("marketplace_product_id") REFERENCES "public"."tcg_marketplace_product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_marketplace_product" ADD CONSTRAINT "tcg_marketplace_product_variant_id_tcg_artwork_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."tcg_artwork"("variant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tcg_marketplace_product_marketplace_externalId_unique_idx" ON "tcg_marketplace_product" USING btree ("marketplace","external_id");