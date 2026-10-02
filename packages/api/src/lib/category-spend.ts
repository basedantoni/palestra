/**
 * Pure Spend per category for one Month (KOI-292). Unlike budget-spend's
 * `spendByCategory` (Budgeted Spend), Uncategorized is kept as its own row, so
 * the rows add up to the Month's Spend in `cashFlow`.
 */
import { calendarMonthOf } from "./budget-spend";
import { type CashFlowTransaction, cents, isSpend } from "./cash-flow";

export interface CategorySpendTransaction extends CashFlowTransaction {
  categoryId: string | null;
  categoryName: string | null;
}

export interface CategorySpendRow {
  /** null = Uncategorized. */
  categoryId: string | null;
  name: string;
  /** Net of refunds, so it can be negative. */
  spend: number;
  /** Fraction of the Month's total Spend; null when that total is not positive. */
  share: number | null;
}

export const UNCATEGORIZED = "Uncategorized";

/** Spend per category for `monthKey` ("YYYY-MM"), largest first; categories netting to zero are left out. */
export function categorySpend(transactions: CategorySpendTransaction[], monthKey: string): CategorySpendRow[] {
  const byCategory = new Map<string | null, { name: string; spend: number }>();
  for (const t of transactions) {
    if (!isSpend(t) || calendarMonthOf(t.date) !== monthKey) continue;
    const row = byCategory.get(t.categoryId) ?? { name: t.categoryName ?? UNCATEGORIZED, spend: 0 };
    row.spend += t.amount;
    byCategory.set(t.categoryId, row);
  }

  const rows = [...byCategory]
    .map(([categoryId, { name, spend }]) => ({ categoryId, name, spend: cents(spend) }))
    .filter((r) => r.spend !== 0);
  const total = rows.reduce((s, r) => s + r.spend, 0);
  return rows
    .toSorted((a, b) => b.spend - a.spend)
    .map((r) => ({ ...r, share: total > 0 ? r.spend / total : null }));
}

export interface DonutSlice {
  /** Category id, or "uncategorized" / "other". */
  key: string;
  name: string;
  spend: number;
}

/** Slices before the rest fold into "Other". */
export const DONUT_TOP = 6;

/**
 * Donut slices for `categorySpend` rows (sorted, largest first): the top
 * categories plus "Other". Negative categories are left out; a slice can't be
 * negative.
 */
export function donutSlices(rows: CategorySpendRow[]): DonutSlice[] {
  const positive = rows.filter((r) => r.spend > 0);
  const slices = positive
    .slice(0, DONUT_TOP)
    .map((r) => ({ key: r.categoryId ?? "uncategorized", name: r.name, spend: r.spend }));
  const rest = positive.slice(DONUT_TOP);
  if (rest.length > 0) {
    slices.push({ key: "other", name: "Other", spend: cents(rest.reduce((s, r) => s + r.spend, 0)) });
  }
  return slices;
}
