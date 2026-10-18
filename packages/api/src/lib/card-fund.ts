/**
 * Pure Card Fund (KOI-312, ADR 0005): the Cards category's monthly finance
 * budgets summed from a start month through the current month, minus that
 * category's Budgeted Spend (with its Subcategories', KOI-337) over the same
 * months. Unspent budget carries forward here only; finance budgets keep
 * their no-rollover rule.
 */
import { addMonths } from "@life-tracker/shared";

import { spendHistory, type SpendTransaction } from "./budget-spend";
import { cents } from "./cash-flow";

export interface CardFundInput {
  /** The Cards category and its Subcategories. */
  categoryIds: string[];
  /** That category's monthly budget limits (dollars). */
  limits: Array<{ monthKey: string; limitAmount: number }>;
  transactions: SpendTransaction[];
  /** YYYY-MM, inclusive. */
  startMonth: string;
  /** YYYY-MM in the user's timezone, inclusive. */
  currentMonth: string;
}

export interface CardFund {
  balance: number;
  /** The current month's Cards budget (null when none) and spend. */
  thisMonth: { limit: number | null; spent: number };
  /** Months start..current with no Cards budget: they add nothing to the fund. */
  missingMonths: string[];
}

export function cardFund({ categoryIds, limits, transactions, startMonth, currentMonth }: CardFundInput): CardFund {
  const months: string[] = [];
  for (let m = startMonth; m <= currentMonth; m = addMonths(m, 1)) months.push(m);

  const limitOf = new Map(limits.map((l) => [l.monthKey, l.limitAmount]));
  const spent = spendHistory(transactions, categoryIds, [...months, currentMonth]);
  const thisMonthSpent = spent.pop()!;

  const budgeted = months.reduce((sum, m) => sum + (limitOf.get(m) ?? 0), 0);
  const balance = budgeted - spent.reduce((sum, s) => sum + s, 0);

  return {
    balance: cents(balance),
    thisMonth: { limit: limitOf.get(currentMonth) ?? null, spent: cents(thisMonthSpent) },
    missingMonths: months.filter((m) => !limitOf.has(m)),
  };
}
