/**
 * Pure month-to-date Pace (KOI-344): cumulative Budgeted Spend per day of a
 * Month against Pace, the straight path to its Total Budget (GLOSSARY.md).
 */
import { daysInMonth } from "@life-tracker/shared";

import { calendarMonthOf, isBudgetSpend, type SpendTransaction } from "./budget-spend";
import { cents } from "./cash-flow";

/** Days in a "YYYY-MM" Month. */
export function monthLength(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number) as [number, number];
  return daysInMonth(year, month);
}

/** Pace for each day of a Month (index 0 = day 1): $0 on day 1, `totalBudget` on its last. */
export function pacePoints(days: number, totalBudget: number): number[] {
  return Array.from({ length: days }, (_, i) => cents((totalBudget * i) / (days - 1)));
}

/**
 * Cumulative Budgeted Spend at the end of each day of `monthKey` (index 0 =
 * day 1). Refunds net in, so it can fall. Rows carry `excluded` from the
 * caller's `skippedInTotals`, so Excluded rows and split parents drop out.
 */
export function cumulativeByDay(rows: SpendTransaction[], monthKey: string): number[] {
  const daily = Array<number>(monthLength(monthKey)).fill(0);
  for (const t of rows) {
    // Plaid dates are UTC midnight of the bank's calendar date (see calendarMonthOf).
    if (isBudgetSpend(t) && calendarMonthOf(t.date) === monthKey) daily[t.date.getUTCDate() - 1]! += t.amount;
  }
  let running = 0;
  return daily.map((amount) => (running = cents(running + amount)));
}

/** Days of `monthKey` that have begun by `today` ("YYYY-MM-DD"): all of a past Month, none of a future one. */
export function elapsedDays(monthKey: string, today: string): number {
  const currentMonth = today.slice(0, 7);
  if (monthKey < currentMonth) return monthLength(monthKey);
  return monthKey === currentMonth ? Number(today.slice(8, 10)) : 0;
}

/**
 * Over (positive) or under (negative) Pace on the last elapsed day: that day's
 * cumulative minus its Pace. Null when no day has elapsed.
 */
export function overUnder(cumulative: number[], pace: number[], elapsed: number): number | null {
  return elapsed === 0 ? null : cents(cumulative[elapsed - 1]! - pace[elapsed - 1]!);
}
