CREATE TYPE "public"."account_type" AS ENUM('depository', 'credit', 'investment', 'loan');--> statement-breakpoint
CREATE TABLE "financial_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plaid_item_id" uuid NOT NULL,
	"plaid_account_id" text NOT NULL,
	"name" text NOT NULL,
	"official_name" text,
	"mask" text,
	"type" "account_type" NOT NULL,
	"subtype" text,
	"current_balance" real,
	"available_balance" real,
	"iso_currency_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plaid_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"institution_id" text,
	"institution_name" text,
	"access_token_enc" text NOT NULL,
	"transaction_cursor" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_plaid_item_id_plaid_item_id_fk" FOREIGN KEY ("plaid_item_id") REFERENCES "public"."plaid_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_item" ADD CONSTRAINT "plaid_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_account_userId_idx" ON "financial_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "financial_account_plaidItemId_idx" ON "financial_account" USING btree ("plaid_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_account_plaidAccountId_unique_idx" ON "financial_account" USING btree ("plaid_account_id");--> statement-breakpoint
CREATE INDEX "plaid_item_userId_idx" ON "plaid_item" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plaid_item_itemId_unique_idx" ON "plaid_item" USING btree ("item_id");