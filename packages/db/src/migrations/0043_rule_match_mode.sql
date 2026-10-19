CREATE TYPE "public"."rule_match_mode" AS ENUM('exact', 'contains');--> statement-breakpoint
ALTER TABLE "category_rule" RENAME TO "rule";--> statement-breakpoint
ALTER TABLE "rule" RENAME CONSTRAINT "category_rule_pkey" TO "rule_pkey";--> statement-breakpoint
ALTER TABLE "rule" RENAME CONSTRAINT "category_rule_user_id_user_id_fk" TO "rule_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "rule" RENAME CONSTRAINT "category_rule_category_id_category_id_fk" TO "rule_category_id_category_id_fk";--> statement-breakpoint
DROP INDEX "category_rule_userId_pattern_unique_idx";--> statement-breakpoint
ALTER TABLE "rule" ADD COLUMN "pattern_key" text;--> statement-breakpoint
-- Existing rules keyed close to how `fold` (rules.ts) keys new ones: combining accents stripped, lower case.
UPDATE "rule" SET "pattern_key" = lower(regexp_replace(normalize("pattern", NFD), '[\u0300-\u036f]', '', 'g'));--> statement-breakpoint
-- The old index only ignored case, so "Cafe" and "Café" could both exist. Keep both: the newer one's key
-- gets its id appended, so the unique index below can be built. validatePattern still treats them as one.
UPDATE "rule" SET "pattern_key" = "pattern_key" || ':' || "id" WHERE EXISTS (
  SELECT 1 FROM "rule" older WHERE older."user_id" = "rule"."user_id" AND older."pattern_key" = "rule"."pattern_key"
    AND (older."created_at", older."id") < ("rule"."created_at", "rule"."id")
);--> statement-breakpoint
ALTER TABLE "rule" ALTER COLUMN "pattern_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rule" ADD COLUMN "match_mode" "rule_match_mode" DEFAULT 'contains' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "rule_userId_matchMode_patternKey_unique_idx" ON "rule" USING btree ("user_id","match_mode","pattern_key");
