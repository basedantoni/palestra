import { and, eq, min } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { balanceSnapshot, category, financialAccount, transaction } from "@life-tracker/db/schema/index";
import { addMonths, resolvePeriodBounds, todayInTimeZone } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import { calendarMonthOf } from "../lib/budget-spend";
import { CASH_FLOW_RANGES, type CashFlowRange, cashFlow } from "../lib/cash-flow";
import { categorySpend } from "../lib/category-spend";
import { netWorthHistory } from "../lib/net-worth";
import { getUserTimezone } from "../lib/user-timezone";
import { dateBoundConditions, periodSchema } from "./transactions";

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
      const inWindow = dateBoundConditions({
        from: months === null ? undefined : `${addMonths(currentMonth, 1 - months)}-01`,
      });

      const [[first], txns] = await Promise.all([
        db.select({ date: min(transaction.date) }).from(transaction).where(eq(transaction.userId, userId)),
        db
          .select({
            amount: transaction.amount,
            flow: transaction.flow,
            excluded: transaction.excluded,
            date: transaction.date,
          })
          .from(transaction)
          .where(and(eq(transaction.userId, userId), ...inWindow)),
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
          excluded: transaction.excluded,
          date: transaction.date,
          categoryId: transaction.categoryId,
          categoryName: category.name,
        })
        .from(transaction)
        .leftJoin(category, eq(category.id, transaction.categoryId))
        .where(and(eq(transaction.userId, userId), ...dateBoundConditions(bounds)));
      return categorySpend(txns, bounds);
    }),

  /**
   * Weekly Net Worth over all Balance Snapshot history (linked accounts only),
   * plus `current` and `change30d`. See lib/net-worth.ts and ADR 0003.
   */
  netWorthHistory: protectedProcedure.query(async ({ ctx }) => {
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
    return netWorthHistory(accounts, snapshots);
  }),
});
