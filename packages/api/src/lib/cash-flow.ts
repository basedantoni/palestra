/**
 * Pure monthly cash flow (KOI-291): Income, Spend and Net per Month, per the
 * definitions in GLOSSARY.md and ADR 0002.
 */
import { addMonths } from "@life-tracker/shared";

import { calendarMonthOf, type TransactionFlow } from "./budget-spend";

export interface CashFlowTransaction {
  /** Plaid sign convention: positive = money out. */
  amount: number;
  flow: TransactionFlow | null;
  excluded: boolean;
  date: Date;
}

export interface CashFlowMonth {
  monthKey: string;
  income: number;
  spend: number;
  net: number;
  isPartial: boolean;
}

export interface CashFlowSummary {
  /** Mean monthly Net; null with no complete months. */
  avgNet: number | null;
  /** sum(net) / sum(income) as a fraction; null when income is 0. */
  savingsRate: number | null;
}

/** Float sums drift (0.1 + 0.2); money is shown to the cent. */
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Income, Spend and Net for the `months` calendar months ending at
 * `currentMonth` (oldest first), starting no earlier than `firstMonth` (the
 * month of the user's earliest transaction; null = none). The current month
 * is partial.
 */
export function cashFlow(
  transactions: CashFlowTransaction[],
  opts: { currentMonth: string; months: number; firstMonth: string | null },
): { months: CashFlowMonth[]; summary: CashFlowSummary } {
  const totals = new Map<string, { income: number; spend: number }>();
  for (let i = opts.months - 1; i >= 0; i--) {
    const monthKey = addMonths(opts.currentMonth, -i);
    // No padding before the user's history begins ("YYYY-MM" compares lexically).
    if (opts.firstMonth !== null && monthKey >= opts.firstMonth) {
      totals.set(monthKey, { income: 0, spend: 0 });
    }
  }

  for (const t of transactions) {
    const month = totals.get(calendarMonthOf(t.date));
    if (!month || t.excluded) continue;
    if (t.flow === "expense") month.spend += t.amount;
    else if (t.flow === "income") month.income -= t.amount;
  }

  const months = [...totals].map(([monthKey, { income, spend }]) => ({
    monthKey,
    income: cents(income),
    spend: cents(spend),
    net: cents(income - spend),
    isPartial: monthKey === opts.currentMonth,
  }));
  return { months, summary: summarize(months) };
}

/** Complete months the summary tiles average over. */
export const SUMMARY_MONTHS = 5;

/** Avg Net and Savings Rate over the last complete months; the partial month would skew both. */
function summarize(months: CashFlowMonth[]): CashFlowSummary {
  const complete = months.filter((m) => !m.isPartial).slice(-SUMMARY_MONTHS);
  const income = complete.reduce((s, m) => s + m.income, 0);
  const net = complete.reduce((s, m) => s + m.net, 0);
  return {
    avgNet: complete.length === 0 ? null : cents(net / complete.length),
    savingsRate: income === 0 ? null : net / income,
  };
}
