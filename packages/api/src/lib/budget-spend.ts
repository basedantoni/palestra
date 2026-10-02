/**
 * Pure compute-on-read budget spend (KOI-109, Seam 3).
 *
 * "Spent" = sum of expense, non-excluded transactions in a category for a
 * calendar month. No materialized spend table — this runs over
 * already-fetched rows.
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

/**
 * YYYY-MM of a transaction's calendar date. Plaid dates are stored as UTC
 * midnight of the bank's posted date, so read them in UTC — converting to the
 * user's timezone would push the 1st of a month into the previous one.
 */
export function calendarMonthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** Counts toward budgets: a non-excluded expense with a category. */
function isBudgetSpend(t: SpendTransaction): t is SpendTransaction & { categoryId: string } {
  return t.flow === "expense" && !t.excluded && t.categoryId !== null;
}

/** Spend per category for one calendar month (every category with spend, budgeted or not). */
export function spendByCategory(transactions: SpendTransaction[], monthKey: string): Map<string, number> {
  const spent = new Map<string, number>();
  for (const t of transactions) {
    if (!isBudgetSpend(t) || calendarMonthOf(t.date) !== monthKey) continue;
    spent.set(t.categoryId, (spent.get(t.categoryId) ?? 0) + t.amount);
  }
  return spent;
}

/** One category's spend for each of `monthKeys`, in order (0 when none). */
export function spendHistory(transactions: SpendTransaction[], categoryId: string, monthKeys: string[]): number[] {
  const byMonth = new Map<string, number>();
  for (const t of transactions) {
    if (!isBudgetSpend(t) || t.categoryId !== categoryId) continue;
    const month = calendarMonthOf(t.date);
    byMonth.set(month, (byMonth.get(month) ?? 0) + t.amount);
  }
  return monthKeys.map((m) => byMonth.get(m) ?? 0);
}
