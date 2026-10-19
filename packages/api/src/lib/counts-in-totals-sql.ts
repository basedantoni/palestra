/**
 * Whether a transaction row counts in totals (KOI-338): it isn't Excluded
 * (GLOSSARY.md), so neither excluded by hand nor in an Excluded Category,
 * itself or through its Parent Category. Every Spend, Income and Budgeted
 * Spend query reads it, as `excluded: isExcluded` for the pure aggregations
 * or in a `filter (where …)`. A correlated subquery, so it needs
 * no join and works on any query over `transaction`.
 *
 * Written as plain SQL: drizzle drops the table name from a column in a
 * single-table select, which would point the subquery's references at itself.
 * So it binds to the table named "transaction": a query that aliases it (a
 * self-join) needs its own copy.
 */
import { sql } from "drizzle-orm";

export const countsInTotals = sql<boolean>`(not "transaction"."excluded" and not exists (
  select 1 from "category" own left join "category" parent on parent.id = own.parent_id
  where own.id = "transaction"."category_id" and (own.excluded or parent.excluded is true)
))`;

/** Excluded (GLOSSARY.md): the negation, for the pure aggregations' `excluded` field. */
export const isExcluded = sql<boolean>`not ${countsInTotals}`;
