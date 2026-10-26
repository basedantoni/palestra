/**
 * Whether a transaction row counts in totals (KOI-338): it isn't Excluded
 * (GLOSSARY.md), so neither excluded by hand nor in an Excluded Category,
 * itself or through its Parent Category, and it has no Splits: those count
 * in its place (ADR 0007). Every Spend, Income and Budgeted
 * Spend query reads it, as `excluded: skippedInTotals` for the pure aggregations
 * or in a `filter (where …)`. Correlated subqueries, so they need
 * no join and work on any query over `transaction`.
 *
 * Written as plain SQL: drizzle drops the table name from a column in a
 * single-table select, which would point the subquery's references at itself.
 * So it binds to the table named "transaction": a query that aliases it (a
 * self-join) needs its own copy.
 */
import { sql } from "drizzle-orm";

/** Excluded (GLOSSARY.md): by hand, or in an Excluded Category itself or through its Parent Category. */
export const isExcluded = sql<boolean>`("transaction"."excluded" or exists (
  select 1 from "category" own left join "category" parent on parent.id = own.parent_id
  where own.id = "transaction"."category_id" and (own.excluded or parent.excluded is true)
))`;

/** The transaction has Splits (ADR 0007). */
export const hasSplits = sql<boolean>`exists (select 1 from "transaction" split where split.parent_transaction_id = "transaction"."id")`;

export const countsInTotals = sql<boolean>`(not ${isExcluded} and not ${hasSplits})`;

/** The negation, for the pure aggregations' `excluded` field: Excluded, or split. */
export const skippedInTotals = sql<boolean>`not ${countsInTotals}`;
