import { and, eq, gte, lt, min } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { balanceSnapshot, category, financialAccount, transaction } from "@life-tracker/db/schema/index";
import { addMonths, todayInTimeZone } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import { calendarMonthOf } from "../lib/budget-spend";
import { cashFlow } from "../lib/cash-flow";
import { categorySpend } from "../lib/category-spend";
import { netWorthHistory } from "../lib/net-worth";
import { getUserTimezone } from "../lib/user-timezone";

export const financeRouter = router({
  /**
   * Income, Spend and Net per Month for the last `months` months (current
   * month partial), plus Avg Net and Savings Rate over the last 5 complete
   * months. Spend uses the same rule as `transactions.summary`.
   */
  cashFlow: protectedProcedure
    .input(z.object({ months: z.number().int().min(1).max(24).default(6) }).default({ months: 6 }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const currentMonth = todayInTimeZone(new Date(), await getUserTimezone(userId)).slice(0, 7);
      const windowStart = new Date(`${addMonths(currentMonth, 1 - input.months)}-01T00:00:00.000Z`);

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
          .where(and(eq(transaction.userId, userId), gte(transaction.date, windowStart))),
      ]);

      return cashFlow(txns, {
        currentMonth,
        months: input.months,
        firstMonth: first?.date ? calendarMonthOf(first.date) : null,
      });
    }),

  /**
   * Spend per category for one Month, largest first, Uncategorized as its own
   * row (categoryId null). Rows add up to that Month's spend in `cashFlow`.
   */
  spendByCategory: protectedProcedure
    .input(z.object({ monthKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }))
    .query(async ({ ctx, input }) => {
      // Plaid dates are UTC midnight of the bank's calendar date (see calendarMonthOf).
      const from = new Date(`${input.monthKey}-01T00:00:00.000Z`);
      const to = new Date(`${addMonths(input.monthKey, 1)}-01T00:00:00.000Z`);
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
        .where(
          and(eq(transaction.userId, ctx.session.user.id), gte(transaction.date, from), lt(transaction.date, to)),
        );
      return categorySpend(txns, input.monthKey);
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
