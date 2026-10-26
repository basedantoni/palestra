ALTER TABLE "transaction" ALTER COLUMN "plaid_transaction_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "parent_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_parent_transaction_id_transaction_id_fk" FOREIGN KEY ("parent_transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_parentTransactionId_idx" ON "transaction" USING btree ("parent_transaction_id");