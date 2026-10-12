CREATE TABLE "tcg_art_rating" (
	"user_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"rating" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tcg_art_rating_user_id_variant_id_pk" PRIMARY KEY("user_id","variant_id"),
	CONSTRAINT "tcg_art_rating_range" CHECK ("tcg_art_rating"."rating" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "tcg_artwork_theme" (
	"theme_id" uuid NOT NULL,
	"variant_id" text NOT NULL,
	CONSTRAINT "tcg_artwork_theme_theme_id_variant_id_pk" PRIMARY KEY("theme_id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "tcg_theme" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tcg_art_rating" ADD CONSTRAINT "tcg_art_rating_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_art_rating" ADD CONSTRAINT "tcg_art_rating_variant_id_tcg_artwork_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."tcg_artwork"("variant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_artwork_theme" ADD CONSTRAINT "tcg_artwork_theme_theme_id_tcg_theme_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."tcg_theme"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_artwork_theme" ADD CONSTRAINT "tcg_artwork_theme_variant_id_tcg_artwork_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."tcg_artwork"("variant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_theme" ADD CONSTRAINT "tcg_theme_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tcg_artwork_theme_variantId_idx" ON "tcg_artwork_theme" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tcg_theme_userId_name_unique_idx" ON "tcg_theme" USING btree ("user_id",lower("name"));