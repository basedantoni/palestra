import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { budget, category, transaction, userPreferences } from "@life-tracker/db/schema/index";

import { protectedProcedure, router } from "../index";
import { computeBudgetSpend } from "../lib/budget-spend";

const monthKeySchema = z.string().regex(/^\d{4}-\d{2}$/, "monthKey must be YYYY-MM");

async function userTimezone(userId: string): Promise<string> {
  const [prefs] = await db
    .select({ timezone: userPreferences.timezone })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return prefs?.timezone ?? "America/Chicago";
}

export const budgetsRouter = router({
  /** Budgets for a month joined with computed spend. */
  forMonth: protectedProcedure
    .input(z.object({ monthKey: monthKeySchema }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const timeZone = await userTimezone(userId);

      const budgetRows = await db
        .select({
          categoryId: budget.categoryId,
          limitAmount: budget.limitAmount,
          categoryName: category.name,
        })
        .from(budget)
        .innerJoin(category, eq(category.id, budget.categoryId))
        .where(and(eq(budget.userId, userId), eq(budget.monthKey, input.monthKey)));

      const txns = await db
        .select({
          categoryId: transaction.categoryId,
          amount: transaction.amount,
          flow: transaction.flow,
          excluded: transaction.excluded,
          date: transaction.date,
        })
        .from(transaction)
        .where(eq(transaction.userId, userId));

      const spend = computeBudgetSpend({
        transactions: txns,
        budgets: budgetRows.map((b) => ({ categoryId: b.categoryId, limit: b.limitAmount })),
        monthKey: input.monthKey,
        timeZone,
      });

      const nameById = new Map(budgetRows.map((b) => [b.categoryId, b.categoryName]));
      return spend.map((row) => ({ ...row, categoryName: nameById.get(row.categoryId) ?? "" }));
    }),

  /** Create or update a category's monthly limit. */
  upsert: protectedProcedure
    .input(
      z.object({
        categoryId: z.string().uuid(),
        monthKey: monthKeySchema,
        limitAmount: z.number().nonnegative(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await db
        .insert(budget)
        .values({
          id: randomUUID(),
          userId: ctx.session.user.id,
          categoryId: input.categoryId,
          monthKey: input.monthKey,
          limitAmount: input.limitAmount,
        })
        .onConflictDoUpdate({
          target: [budget.userId, budget.categoryId, budget.monthKey],
          set: { limitAmount: input.limitAmount },
        });
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(budget)
        .where(and(eq(budget.id, input.id), eq(budget.userId, ctx.session.user.id)));
      return { ok: true };
    }),
});
