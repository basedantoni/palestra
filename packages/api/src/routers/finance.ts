import { and, eq, gte, min } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { transaction } from "@life-tracker/db/schema/index";
import { addMonths, todayInTimeZone } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import { calendarMonthOf } from "../lib/budget-spend";
import { cashFlow } from "../lib/cash-flow";
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
});
