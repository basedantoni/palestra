/**
 * Pure Spend per category for a period (KOI-292, KOI-294, KOI-345). Unlike
 * budget-spend's `spendByCategory` (Budgeted Spend), Uncategorized is kept as
 * its own row, so the top-level totals add up to Spend in `cashFlow` for the
 * same range.
 */
import { categoryTree } from "@life-tracker/shared";

import { type CashFlowTransaction, cents, isSpend } from "./cash-flow";

export interface CategorySpendTransaction extends CashFlowTransaction {
  categoryId: string | null;
}

export interface SpendCategory {
  id: string;
  name: string;
  parentId: string | null;
  /** Palette token; null when uncolored. */
  color: string | null;
  icon: string | null;
}

export interface CategorySpendNode {
  /** null = Uncategorized. */
  categoryId: string | null;
  name: string;
  /** Palette token (a Subcategory's is its parent's); null for Uncategorized or an uncolored category. */
  color: string | null;
  /** A Subcategory's `subcategoryTint`; null at the top level. */
  tint: number | null;
  /** Lucide icon name (`CATEGORY_ICONS`); null for none. */
  icon: string | null;
  /** Its own Spend plus its Subcategories'. Net of refunds, so it can be negative. */
  total: number;
  /** Spend on transactions filed under the category itself. */
  own: number;
  /** Subcategories with Spend, largest first. */
  children: CategorySpendNode[];
}

export const UNCATEGORIZED = "Uncategorized";

const byTotal = (a: CategorySpendNode, b: CategorySpendNode) => b.total - a.total;

/**
 * Spend per category between inclusive calendar-day bounds ("YYYY-MM-DD",
 * from `resolvePeriodBounds`; a missing bound is open), as the two-level
 * tree: each Parent Category's total rolls up its Subcategories'. Both levels
 * are ranked largest first; categories netting to zero are left out.
 * `categories` come in manual order, which sets Subcategory tints.
 */
export function categorySpendTree(
  transactions: CategorySpendTransaction[],
  categories: SpendCategory[],
  { from, to }: { from?: string; to?: string },
): CategorySpendNode[] {
  const ownByCategory = new Map<string | null, number>();
  for (const t of transactions) {
    // Plaid dates are UTC midnight of the bank's calendar date (see calendarMonthOf).
    const day = t.date.toISOString().slice(0, 10);
    if (!isSpend(t) || (from && day < from) || (to && day > to)) continue;
    ownByCategory.set(t.categoryId, (ownByCategory.get(t.categoryId) ?? 0) + t.amount);
  }

  const node = (
    c: { id: string | null; name: string; color: string | null; tint: number | null; icon: string | null },
    children: CategorySpendNode[] = [],
  ): CategorySpendNode => {
    const own = cents(ownByCategory.get(c.id) ?? 0);
    const total = cents(children.reduce((s, child) => s + child.total, own));
    return { categoryId: c.id, name: c.name, color: c.color, tint: c.tint, icon: c.icon, total, own, children: children.toSorted(byTotal) };
  };

  const tree = categoryTree(categories);
  const ids = new Set(categories.map((c) => c.id));
  const top = tree
    .filter((c) => !c.parentId || !ids.has(c.parentId))
    .map((parent) =>
      node(
        parent,
        tree
          .filter((c) => c.parentId === parent.id)
          .map((c) => node(c))
          .filter((n) => n.total !== 0),
      ),
    );
  top.push(node({ id: null, name: UNCATEGORIZED, color: null, tint: null, icon: null }));
  return top.filter((n) => n.total !== 0).toSorted(byTotal);
}
