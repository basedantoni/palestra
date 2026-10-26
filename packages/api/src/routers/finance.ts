import { and, eq, min } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { balanceSnapshot, budget, category, financialAccount, transaction } from "@life-tracker/db/schema/index";
import { addMonths, resolvePeriodBounds, todayInTimeZone } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import { calendarMonthOf, totalBudget } from "../lib/budget-spend";
import { monthKeySchema, monthRange, spendColumns } from "../lib/budget-spend-sql";
import { CASH_FLOW_RANGES, type CashFlowRange, cashFlow } from "../lib/cash-flow";
import { categorySpend } from "../lib/category-spend";
import { skippedInTotals } from "../lib/counts-in-totals-sql";
import { cumulativeByDay, elapsedDays, monthLength, overUnder, pacePoints } from "../lib/month-pace";
import { netWorthHistory, TIMEFRAMES, timeframeWindow } from "../lib/net-worth";
import { dateBoundConditions, periodSchema } from "../lib/transaction-period-sql";
import { getUserTimezone } from "../lib/user-timezone";

const cashFlowRanges = Object.keys(CASH_FLOW_RANGES) as [CashFlowRange, ...CashFlowRange[]];

export const financeRouter = router({
  /**
   * Income, Spend and Net per Month over `range` (current month partial; All
   * starts at the first transaction), plus Avg Net and Savings Rate over the
   * last 5 complete months whatever the range. Spend uses the same rule as
   * `transactions.summary`.
   */
  cashFlow: protectedProcedure
    .input(z.object({ range: z.enum(cashFlowRanges).default("6M") }).default({ range: "6M" }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const currentMonth = todayInTimeZone(new Date(), await getUserTimezone(userId)).slice(0, 7);
      const months = CASH_FLOW_RANGES[input.range];
      const ofUser = eq(transaction.userId, userId);
      const columns = {
        amount: transaction.amount,
        flow: transaction.flow,
        excluded: skippedInTotals,
        date: transaction.date,
      };

      // All history loads every transaction, so the earliest of them starts the range.
      if (months === null) {
        const txns = await db.select(columns).from(transaction).where(ofUser);
        return cashFlow(txns, { currentMonth, months });
      }

      const inWindow = dateBoundConditions({ from: `${addMonths(currentMonth, 1 - months)}-01` });
      const [[first], txns] = await Promise.all([
        db.select({ date: min(transaction.date) }).from(transaction).where(ofUser),
        db.select(columns).from(transaction).where(and(ofUser, ...inWindow)),
      ]);
      return cashFlow(txns, {
        currentMonth,
        months,
        firstMonth: first?.date ? calendarMonthOf(first.date) : null,
      });
    }),

  /**
   * Spend per category for a period (same model as the transaction feed),
   * largest first, Uncategorized as its own row (categoryId null). Rows add up
   * to Spend for that range (`cashFlow`, `transactions.summary`).
   */
  spendByCategory: protectedProcedure
    .input(z.object({ period: periodSchema }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const bounds = resolvePeriodBounds(input.period, todayInTimeZone(new Date(), await getUserTimezone(userId)));
      const txns = await db
        .select({
          amount: transaction.amount,
          flow: transaction.flow,
          excluded: skippedInTotals,
          date: transaction.date,
          categoryId: transaction.categoryId,
          categoryName: category.name,
          categoryColor: category.color,
          categoryIcon: category.icon,
        })
        .from(transaction)
        .leftJoin(category, eq(category.id, transaction.categoryId))
        .where(and(eq(transaction.userId, userId), ...dateBoundConditions(bounds)));
      return categorySpend(txns, bounds);
    }),

  /**
   * Month-to-date Pace (KOI-344): cumulative Budgeted Spend per day of the
   * Month (null after today) and last month's by the same day (null past its
   * end), against Pace to the Total Budget. No budgets: Total Budget, Pace and
   * over/under are null.
   */
  monthPace: protectedProcedure
    .input(z.object({ monthKey: monthKeySchema }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const lastMonth = addMonths(input.monthKey, -1);
      const [categories, limits, txns, timezone] = await Promise.all([
        db.select({ id: category.id, parentId: category.parentId }).from(category).where(eq(category.userId, userId)),
        db
          .select({ categoryId: budget.categoryId, limitAmount: budget.limitAmount })
          .from(budget)
          .where(and(eq(budget.userId, userId), eq(budget.monthKey, input.monthKey))),
        db
          .select(spendColumns)
          .from(transaction)
          .where(and(eq(transaction.userId, userId), ...monthRange(lastMonth, input.monthKey))),
        getUserTimezone(userId),
      ]);

      const total =
        limits.length > 0 ? totalBudget(limits.map((l) => ({ ...l, spent: 0 })), categories).limitAmount : null;
      const elapsed = elapsedDays(input.monthKey, todayInTimeZone(new Date(), timezone));
      const cumulative = cumulativeByDay(txns, input.monthKey);
      const lastMonthCumulative = cumulativeByDay(txns, lastMonth);
      const pace = total === null ? null : pacePoints(monthLength(input.monthKey), total);
      return {
        days: cumulative.map((c, i) => ({
          day: i + 1,
          cumulative: i < elapsed ? c : null,
          lastMonthCumulative: lastMonthCumulative[i] ?? null,
          pace: pace?.[i] ?? null,
        })),
        totalBudget: total,
        overUnder: pace ? overUnder(cumulative, pace, elapsed) : null,
      };
    }),

  /**
   * Daily Net Worth (linked accounts only) over a chip's window ending today,
   * plus `current` and `change` since its first non-partial day. See
   * lib/net-worth.ts and ADR 0003.
   */
  netWorthHistory: protectedProcedure.input(z.object({ timeframe: z.enum(TIMEFRAMES) })).query(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    const [accounts, snapshots] = await Promise.all([
      db
        .select({ id: financialAccount.id, type: financialAccount.type })
        .from(financialAccount)
        .where(eq(financialAccount.userId, userId)),
      db
        .select({
          accountId: balanceSnapshot.accountId,
          asOfDate: balanceSnapshot.asOfDate,
          balance: balanceSnapshot.balance,
        })
        .from(balanceSnapshot)
        .where(eq(balanceSnapshot.userId, userId)),
    ]);
    // ponytail: loads all history; carry-forward needs the last snapshot before the window anyway.
    return netWorthHistory(accounts, snapshots, timeframeWindow(input.timeframe));
  }),
});
