-- KOI-301: Uncategorized means no category (glossary), so no real category may
-- carry that name. Covers the seeded one and any user-made one in any case:
-- either would show up as a second Uncategorized.
-- Transactions in it move to category_id = NULL; category_overridden is left as
-- is, so a hand-picked one stays a Manual Category (now with no category) and
-- an automatic one stays automatic (the Default Category for an unmapped Plaid
-- category is now NULL too).
UPDATE "transaction" SET "category_id" = NULL
FROM "category"
WHERE "transaction"."category_id" = "category"."id"
  AND lower("category"."name") = 'uncategorized';--> statement-breakpoint
-- Budgets and Category Rules on it cascade: a budget can't measure spend with
-- no category, and a rule can't assign "no category".
DELETE FROM "category" WHERE lower("name") = 'uncategorized';
