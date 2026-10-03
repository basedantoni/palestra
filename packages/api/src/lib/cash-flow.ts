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
export const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Counts toward Spend (GLOSSARY.md, ADR 0002): a non-excluded expense, with or
 * without a category. Refunds are negative amounts and net in.
 */
export function isSpend(t: Pick<CashFlowTransaction, "flow" | "excluded">): boolean {
  return t.flow === "expense" && !t.excluded;
}

/** Income vs spend range switch (KOI-294): months shown, null = all history. */
export const CASH_FLOW_RANGES = { "6M": 6, "1Y": 12, All: null } as const;
export type CashFlowRange = keyof typeof CASH_FLOW_RANGES;

/**
 * Income, Spend and Net for the `months` calendar months ending at
 * `currentMonth` (oldest first), starting no earlier than `firstMonth` (the
 * month of the user's earliest transaction; null = none). With `months` null
 * the transactions are all history, so the earliest of them starts the range
 * and `firstMonth` is ignored. The current month is partial. The summary
 * covers the last SUMMARY_MONTHS complete months, so it is the same for every
 * CASH_FLOW_RANGES window.
 */
export function cashFlow(
  transactions: CashFlowTransaction[],
  opts: { currentMonth: string; months: number | null; firstMonth?: string | null },
): { months: CashFlowMonth[]; summary: CashFlowSummary } {
  const firstMonth = opts.months === null ? earliestMonth(transactions) : (opts.firstMonth ?? null);
  const totals = new Map<string, { income: number; spend: number }>();
  if (firstMonth !== null) {
    const windowStart = opts.months === null ? firstMonth : addMonths(opts.currentMonth, 1 - opts.months);
    // No padding before the user's history begins ("YYYY-MM" compares lexically).
    const start = windowStart > firstMonth ? windowStart : firstMonth;
    for (let monthKey = start; monthKey <= opts.currentMonth; monthKey = addMonths(monthKey, 1)) {
      totals.set(monthKey, { income: 0, spend: 0 });
    }
  }

  for (const t of transactions) {
    const month = totals.get(calendarMonthOf(t.date));
    if (!month || t.excluded) continue;
    if (isSpend(t)) month.spend += t.amount;
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

/** The month of the earliest transaction, excluded ones too; null with none. */
function earliestMonth(transactions: CashFlowTransaction[]): string | null {
  let first: string | null = null;
  for (const t of transactions) {
    const month = calendarMonthOf(t.date);
    if (first === null || month < first) first = month;
  }
  return first;
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
