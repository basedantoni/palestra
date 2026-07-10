/**
 * Pure compute-on-read budget spend (KOI-109, Seam 3).
 *
 * "Spent this month" = sum of expense, non-excluded transactions in a category
 * for the given month (evaluated in the user's timezone). No materialized
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

const monthKeyFormatters = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM for a date as seen in `timeZone`. */
export function monthKeyOf(date: Date, timeZone: string): string {
  let fmt = monthKeyFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
    });
    monthKeyFormatters.set(timeZone, fmt);
  }
  // en-CA renders as "2026-06"
  return fmt.format(date);
}

export function computeBudgetSpend(args: {
  transactions: SpendTransaction[];
  budgets: BudgetLimit[];
  monthKey: string;
  timeZone: string;
}): BudgetSpendRow[] {
  const { transactions, budgets, monthKey, timeZone } = args;

  const spentByCategory = new Map<string, number>();
  for (const t of transactions) {
    if (t.flow !== "expense" || t.excluded || t.categoryId === null) continue;
    if (monthKeyOf(t.date, timeZone) !== monthKey) continue;
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
