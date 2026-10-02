import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, eq, gte, lt, lte, max, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { budget, category, transaction } from "@life-tracker/db/schema/index";
import { addMonths, todayInTimeZone } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import { spendByCategory, spendHistory } from "../lib/budget-spend";
import { getUserTimezone } from "../lib/user-timezone";

const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "monthKey must be YYYY-MM");

const spendColumns = {
  categoryId: transaction.categoryId,
  amount: transaction.amount,
  flow: transaction.flow,
  excluded: transaction.excluded,
  date: transaction.date,
};

/**
 * Date conditions covering whole calendar months `fromMonth`..`toMonth`.
 * Plaid dates are stored as UTC midnight of the bank's date, so the range is
 * [first day 00:00Z, first day of the following month 00:00Z).
 */
function monthRange(fromMonth: string, toMonth: string): SQL[] {
  return [
    gte(transaction.date, new Date(`${fromMonth}-01T00:00:00.000Z`)),
    lt(transaction.date, new Date(`${addMonths(toMonth, 1)}-01T00:00:00.000Z`)),
  ];
}

/**
 * Where a month's limits could be copied from: the latest earlier month with
 * limits. Only offered for the current or a future month (in the user's
 * timezone) that has no limits yet — copying never creates retroactive budgets
 * or overwrites a month the user already set up.
 */
async function carryOverSource(
  userId: string,
  monthKey: string,
): Promise<{ fromMonth: string; limits: Array<{ categoryId: string; limitAmount: number }> } | null> {
  const currentMonth = todayInTimeZone(new Date(), await getUserTimezone(userId)).slice(0, 7);
  if (monthKey < currentMonth) return null;

  const ownMonth = (m: string) => and(eq(budget.userId, userId), eq(budget.monthKey, m));
  const [existing] = await db.select({ id: budget.id }).from(budget).where(ownMonth(monthKey)).limit(1);
  if (existing) return null;

  const [latest] = await db
    .select({ monthKey: max(budget.monthKey) })
    .from(budget)
    .where(and(eq(budget.userId, userId), lt(budget.monthKey, monthKey)));
  if (!latest?.monthKey) return null;

  const limits = await db
    .select({ categoryId: budget.categoryId, limitAmount: budget.limitAmount })
    .from(budget)
    .where(ownMonth(latest.monthKey));
  return limits.length > 0 ? { fromMonth: latest.monthKey, limits } : null;
}

export const budgetsRouter = router({
  /**
   * Every category for a month with its limit (null = not budgeted) and spend
   * (non-excluded expenses, by the bank's calendar month).
   */
  forMonth: protectedProcedure
    .input(z.object({ monthKey: monthKeySchema }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const categories = await db
        .select({ id: category.id, name: category.name, isSystem: category.isSystem })
        .from(category)
        .where(eq(category.userId, userId))
        .orderBy(category.name);
      const limits = await db
        .select({ categoryId: budget.categoryId, limitAmount: budget.limitAmount })
        .from(budget)
        .where(and(eq(budget.userId, userId), eq(budget.monthKey, input.monthKey)));
      const txns = await db
        .select(spendColumns)
        .from(transaction)
        .where(and(eq(transaction.userId, userId), ...monthRange(input.monthKey, input.monthKey)));

      const spent = spendByCategory(txns, input.monthKey);
      const limitById = new Map(limits.map((l) => [l.categoryId, l.limitAmount]));
      return categories.map((c) => {
        const limit = limitById.get(c.id) ?? null;
        const categorySpent = spent.get(c.id) ?? 0;
        return {
          categoryId: c.id,
          categoryName: c.name,
          isSystem: c.isSystem,
          limit,
          spent: categorySpent,
          overspent: limit !== null && categorySpent > limit,
        };
      });
    }),

  /** One category's spend and limit for the `months` months ending at `monthKey`. */
  history: protectedProcedure
    .input(
      z.object({
        categoryId: z.string().uuid(),
        monthKey: monthKeySchema,
        months: z.number().int().min(1).max(24).default(6),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const monthKeys = Array.from({ length: input.months }, (_, i) =>
        addMonths(input.monthKey, i - input.months + 1),
      );
      const first = monthKeys[0]!;
      const limits = await db
        .select({ monthKey: budget.monthKey, limitAmount: budget.limitAmount })
        .from(budget)
        .where(
          and(
            eq(budget.userId, userId),
            eq(budget.categoryId, input.categoryId),
            gte(budget.monthKey, first),
            lte(budget.monthKey, input.monthKey),
          ),
        );
      const txns = await db
        .select(spendColumns)
        .from(transaction)
        .where(
          and(
            eq(transaction.userId, userId),
            eq(transaction.categoryId, input.categoryId),
            ...monthRange(first, input.monthKey),
          ),
        );

      const spent = spendHistory(txns, input.categoryId, monthKeys);
      const limitByMonth = new Map(limits.map((l) => [l.monthKey, l.limitAmount]));
      return monthKeys.map((monthKey, i) => ({
        monthKey,
        spent: spent[i]!,
        limit: limitByMonth.get(monthKey) ?? null,
      }));
    }),

  /**
   * What "Copy limits" would do for a month: the latest earlier month with
   * limits and how many it has. Null when copying isn't offered.
   */
  carryOverPreview: protectedProcedure
    .input(z.object({ monthKey: monthKeySchema }))
    .query(async ({ ctx, input }) => {
      const source = await carryOverSource(ctx.session.user.id, input.monthKey);
      return source ? { fromMonth: source.fromMonth, count: source.limits.length } : null;
    }),

  /**
   * The explicit "Copy September's limits" action (KOI-284): copies the
   * latest earlier month's limits into an empty current or future month.
   */
  carryOver: protectedProcedure
    .input(z.object({ monthKey: monthKeySchema }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const source = await carryOverSource(userId, input.monthKey);
      if (!source) return { fromMonth: null, copied: 0 };

      await db
        .insert(budget)
        .values(
          source.limits.map((b) => ({
            id: randomUUID(),
            userId,
            categoryId: b.categoryId,
            monthKey: input.monthKey,
            limitAmount: b.limitAmount,
          })),
        )
        .onConflictDoNothing();
      return { fromMonth: source.fromMonth, copied: source.limits.length };
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
      const [owned] = await db
        .select({ id: category.id })
        .from(category)
        .where(and(eq(category.id, input.categoryId), eq(category.userId, ctx.session.user.id)))
        .limit(1);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });

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

  /** Remove a category's limit for one month (KOI-285). */
  remove: protectedProcedure
    .input(z.object({ categoryId: z.string().uuid(), monthKey: monthKeySchema }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(budget)
        .where(
          and(
            eq(budget.userId, ctx.session.user.id),
            eq(budget.categoryId, input.categoryId),
            eq(budget.monthKey, input.monthKey),
          ),
        );
      return { ok: true };
    }),

  /** Remove every limit for a month — the Undo for "Copy limits". */
  clearMonth: protectedProcedure
    .input(z.object({ monthKey: monthKeySchema }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(budget)
        .where(and(eq(budget.userId, ctx.session.user.id), eq(budget.monthKey, input.monthKey)));
      return { ok: true };
    }),
});
