CREATE TYPE "public"."plaid_env" AS ENUM('sandbox', 'production');--> statement-breakpoint
-- Backfill: existing items predate env tagging. Production is right for the deployed app (real banks); a local sandbox item gets mislabeled and can be force-removed and relinked (KOI-288).
ALTER TABLE "plaid_item" ADD COLUMN "plaid_env" "plaid_env" DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE "plaid_item" ALTER COLUMN "plaid_env" DROP DEFAULT;
