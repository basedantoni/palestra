CREATE TYPE "public"."account_source" AS ENUM('plaid', 'snaptrade');--> statement-breakpoint
ALTER TABLE "financial_account" ALTER COLUMN "plaid_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_account" ALTER COLUMN "plaid_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_account" ADD COLUMN "source" "account_source" DEFAULT 'plaid' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_account" ADD COLUMN "snaptrade_account_id" text;--> statement-breakpoint
ALTER TABLE "financial_account" ADD COLUMN "institution_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_account_snaptradeAccountId_unique_idx" ON "financial_account" USING btree ("snaptrade_account_id");--> statement-breakpoint
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_source_identity" CHECK (("financial_account"."source" = 'plaid' and "financial_account"."plaid_item_id" is not null and "financial_account"."plaid_account_id" is not null and "financial_account"."snaptrade_account_id" is null)
        or ("financial_account"."source" = 'snaptrade' and "financial_account"."snaptrade_account_id" is not null and "financial_account"."plaid_item_id" is null and "financial_account"."plaid_account_id" is null));