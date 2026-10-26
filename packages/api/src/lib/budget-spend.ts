/**
 * Pure compute-on-read budget spend (KOI-109, Seam 3).
 *
 * "Spent" = sum of expense, non-excluded transactions in a category for a
 * calendar month. No materialized spend table — this runs over
 * already-fetched rows.
 */
import { addMonths } from "@life-tracker/shared";

export type TransactionFlow = "income" | "expense" | "transfer";

export interface SpendTransaction {
  categoryId: string | null;
  /** Plaid sign convention: positive = money out (an expense). */
  amount: number;
  flow: TransactionFlow | null;
  /** Doesn't count in totals: Excluded, or split (`skippedInTotals`, counts-in-totals-sql.ts). */
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
export function isBudgetSpend(t: SpendTransaction): t is SpendTransaction & { categoryId: string } {
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

/**
 * The spend of `categoryIds` together for each of `monthKeys`, in order (0
 * when none): one category, or a Parent Category and its Subcategories.
 */
export function spendHistory(transactions: SpendTransaction[], categoryIds: string[], monthKeys: string[]): number[] {
  const ids = new Set(categoryIds);
  const byMonth = new Map<string, number>();
  for (const t of transactions) {
    if (!isBudgetSpend(t) || !ids.has(t.categoryId)) continue;
    const month = calendarMonthOf(t.date);
    byMonth.set(month, (byMonth.get(month) ?? 0) + t.amount);
  }
  return monthKeys.map((m) => byMonth.get(m) ?? 0);
}

/**
 * The `months` months ending at `monthKey`, oldest first: the spend of
 * `categoryIds` together (a category, or a Parent Category with its
 * Subcategories) and that month's limit, null when it has none.
 */
export function categoryMonthly(
  transactions: SpendTransaction[],
  categoryIds: string[],
  limits: Array<{ monthKey: string; limitAmount: number }>,
  monthKey: string,
  months: number,
): Array<{ monthKey: string; spent: number; limit: number | null }> {
  const monthKeys = Array.from({ length: months }, (_, i) => addMonths(monthKey, i - months + 1));
  const spent = spendHistory(transactions, categoryIds, monthKeys);
  const limitByMonth = new Map(limits.map((l) => [l.monthKey, l.limitAmount]));
  return monthKeys.map((m, i) => ({ monthKey: m, spent: spent[i]!, limit: limitByMonth.get(m) ?? null }));
}

/** Where a category sits in the two-level tree: top level (parentId null) or a Subcategory. */
export interface CategoryNode {
  id: string;
  parentId: string | null;
}

/**
 * Per-category spend with each Parent Category's rolled up: its own spend plus
 * all its Subcategories'. Subcategories keep their own.
 */
export function rollUpSpend(spent: Map<string, number>, categories: CategoryNode[]): Map<string, number> {
  const rolled = new Map(spent);
  for (const c of categories) {
    const own = spent.get(c.id);
    if (c.parentId && own !== undefined) rolled.set(c.parentId, (rolled.get(c.parentId) ?? 0) + own);
  }
  return rolled;
}

/**
 * A Month's Total Budget and the Budgeted Spend it covers: every top-level
 * budget, plus a Subcategory's only when its parent has none that month, so
 * no limit or spend counts twice. `spent` is each budget's rolled-up spend.
 */
export function totalBudget(
  budgets: Array<{ categoryId: string; limitAmount: number; spent: number }>,
  categories: CategoryNode[],
): { limitAmount: number; spent: number } {
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  const budgeted = new Set(budgets.map((b) => b.categoryId));
  const counted = budgets.filter((b) => {
    const parentId = parentOf.get(b.categoryId);
    return !parentId || !budgeted.has(parentId);
  });
  return {
    limitAmount: counted.reduce((sum, b) => sum + b.limitAmount, 0),
    spent: counted.reduce((sum, b) => sum + b.spent, 0),
  };
}
