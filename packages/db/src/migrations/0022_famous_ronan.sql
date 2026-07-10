CREATE TYPE "public"."transaction_flow" AS ENUM('income', 'expense', 'transfer');--> statement-breakpoint
CREATE TABLE "balance_snapshot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"balance" real NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"plaid_transaction_id" text NOT NULL,
	"amount" real NOT NULL,
	"date" timestamp NOT NULL,
	"name" text NOT NULL,
	"merchant_name" text,
	"pending" boolean DEFAULT false NOT NULL,
	"flow" "transaction_flow",
	"plaid_category_primary" text,
	"plaid_category_detailed" text,
	"category_id" uuid,
	"excluded" boolean DEFAULT false NOT NULL,
	"note" text,
	"transfer_pair_id" uuid,
	"iso_currency_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "balance_snapshot" ADD CONSTRAINT "balance_snapshot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_snapshot" ADD CONSTRAINT "balance_snapshot_account_id_financial_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_account_id_financial_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_snapshot_userId_idx" ON "balance_snapshot" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "balance_snapshot_account_date_unique_idx" ON "balance_snapshot" USING btree ("account_id","as_of_date");--> statement-breakpoint
CREATE INDEX "transaction_userId_idx" ON "transaction" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transaction_accountId_idx" ON "transaction" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_plaidTransactionId_unique_idx" ON "transaction" USING btree ("plaid_transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_userId_date_idx" ON "transaction" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "transaction_budget_idx" ON "transaction" USING btree ("user_id","category_id","date","flow");