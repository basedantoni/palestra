ALTER TABLE "rule" ALTER COLUMN "category_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rule" ADD COLUMN "set_flow" "transaction_flow";--> statement-breakpoint
ALTER TABLE "rule" ADD CONSTRAINT "rule_sets_something" CHECK ("rule"."category_id" is not null or "rule"."set_flow" is not null);--> statement-breakpoint
ALTER TABLE "rule" ADD CONSTRAINT "rule_no_category_off_expense" CHECK ("rule"."category_id" is null or "rule"."set_flow" is null or "rule"."set_flow" = 'expense');