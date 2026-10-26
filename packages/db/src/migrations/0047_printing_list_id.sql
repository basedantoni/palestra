DROP INDEX "tcg_printing_variantId_language_unique_idx";--> statement-breakpoint
ALTER TABLE "tcg_printing" ADD COLUMN "list_id" text;--> statement-breakpoint
UPDATE "tcg_printing" SET "list_id" = "variant_id";--> statement-breakpoint
CREATE UNIQUE INDEX "tcg_printing_language_listId_unique_idx" ON "tcg_printing" USING btree ("language","list_id");--> statement-breakpoint
CREATE INDEX "tcg_printing_variantId_idx" ON "tcg_printing" USING btree ("variant_id");