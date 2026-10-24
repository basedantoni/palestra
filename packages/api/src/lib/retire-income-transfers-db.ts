/**
 * One-off: retire the Income and Transfers categories (KOI-341). Categories
 * describe spend only, so income and transfer rows carry none. Every user, one
 * DB transaction, idempotent (a re-run finds nothing to do):
 *
 * 1. Rules on Income or Transfers become flow rules: `{ setFlow, categoryId: null }`.
 *    (A flow rule with the same mode and pattern can't already exist: Patterns
 *    are unique per user and mode, so there is no duplicate to drop.)
 * 2. Income- and transfer-flow rows lose any category; the Manual Category flag stays.
 * 3. Both categories are deleted, matched by their seed names (a renamed one
 *    is kept). The foreign keys do the rest: their budgets go
 *    (cascade), their Bank Category mappings become unmapped and their expense
 *    rows Uncategorized (set null), keeping reviewed state and Manual Category flag.
 *
 * Run: pnpm db:retire-income-transfers
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { category, rule, transaction } from "@life-tracker/db/schema/index";

import { NO_CATEGORY_FLOWS } from "./rules";
import type { Conn } from "./rules-db";
import type { TransactionFlow } from "./transaction-flow";

/** Each retired category and the flow its rules set instead. */
const RETIRED: ReadonlyArray<[name: string, flow: TransactionFlow]> = [
  ["Income", "income"],
  ["Transfers", "transfer"],
];

export async function retireIncomeAndTransfers(conn: Conn): Promise<{ rules: number; transactions: number; categories: number }> {
  return conn.transaction(async (tx) => {
    let rules = 0;
    for (const [name, setFlow] of RETIRED) {
      const ids = tx.select({ id: category.id }).from(category).where(eq(category.name, name));
      const result = await tx.update(rule).set({ setFlow, categoryId: null }).where(inArray(rule.categoryId, ids));
      rules += result.rowCount ?? 0;
    }
    const cleared = await tx
      .update(transaction)
      .set({ categoryId: null })
      .where(and(inArray(transaction.flow, NO_CATEGORY_FLOWS), isNotNull(transaction.categoryId)));
    const deleted = await tx.delete(category).where(inArray(category.name, RETIRED.map(([name]) => name)));
    return { rules, transactions: cleared.rowCount ?? 0, categories: deleted.rowCount ?? 0 };
  });
}
