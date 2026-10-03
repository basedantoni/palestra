/**
 * Pure Spend per category for a period (KOI-292, KOI-294). Unlike budget-spend's
 * `spendByCategory` (Budgeted Spend), Uncategorized is kept as its own row, so
 * the rows add up to Spend in `cashFlow` for the same range.
 */
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
  /** Fraction of the positive categories' total Spend (negative for a net-refund row); null when there is none. */
  share: number | null;
}

export const UNCATEGORIZED = "Uncategorized";

/**
 * Spend per category between inclusive calendar-day bounds ("YYYY-MM-DD",
 * from `resolvePeriodBounds`; a missing bound is open), largest first;
 * categories netting to zero are left out.
 */
export function categorySpend(
  transactions: CategorySpendTransaction[],
  { from, to }: { from?: string; to?: string },
): CategorySpendRow[] {
  const byCategory = new Map<string | null, { name: string; spend: number }>();
  for (const t of transactions) {
    // Plaid dates are UTC midnight of the bank's calendar date (see calendarMonthOf).
    const day = t.date.toISOString().slice(0, 10);
    if (!isSpend(t) || (from && day < from) || (to && day > to)) continue;
    const row = byCategory.get(t.categoryId) ?? { name: t.categoryName ?? UNCATEGORIZED, spend: 0 };
    row.spend += t.amount;
    byCategory.set(t.categoryId, row);
  }

  const rows = [...byCategory]
    .map(([categoryId, { name, spend }]) => ({ categoryId, name, spend: cents(spend) }))
    .filter((r) => r.spend !== 0);
  // Against positive categories only, so positive shares sum to 100% even in a refund-heavy month.
  const total = rows.reduce((s, r) => s + Math.max(r.spend, 0), 0);
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
