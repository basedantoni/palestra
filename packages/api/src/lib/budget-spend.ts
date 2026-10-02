/**
 * Pure compute-on-read budget spend (KOI-109, Seam 3).
 *
 * "Spent this month" = sum of expense, non-excluded transactions in a category
 * for the given calendar month. No materialized
 * spend table — this runs over already-fetched rows.
 */

export type TransactionFlow = "income" | "expense" | "transfer";

export interface SpendTransaction {
  categoryId: string | null;
  /** Plaid sign convention: positive = money out (an expense). */
  amount: number;
  flow: TransactionFlow | null;
  excluded: boolean;
  date: Date;
}

export interface BudgetLimit {
  categoryId: string;
  limit: number;
}

export interface BudgetSpendRow {
  categoryId: string;
  limit: number;
  spent: number;
  remaining: number;
  overspent: boolean;
}

/**
 * YYYY-MM of a transaction's calendar date. Plaid dates are stored as UTC
 * midnight of the bank's posted date, so read them in UTC — converting to the
 * user's timezone would push the 1st of a month into the previous one.
 */
function calendarMonthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function computeBudgetSpend(args: {
  transactions: SpendTransaction[];
  budgets: BudgetLimit[];
  monthKey: string;
}): BudgetSpendRow[] {
  const { transactions, budgets, monthKey } = args;

  const spentByCategory = new Map<string, number>();
  for (const t of transactions) {
    if (t.flow !== "expense" || t.excluded || t.categoryId === null) continue;
    if (calendarMonthOf(t.date) !== monthKey) continue;
    spentByCategory.set(t.categoryId, (spentByCategory.get(t.categoryId) ?? 0) + t.amount);
  }

  return budgets.map((b) => {
    const spent = spentByCategory.get(b.categoryId) ?? 0;
    return {
      categoryId: b.categoryId,
      limit: b.limit,
      spent,
      remaining: b.limit - spent,
      overspent: spent > b.limit,
    };
  });
}
