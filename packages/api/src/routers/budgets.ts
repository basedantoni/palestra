import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, eq, lt, max } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { budget, category, transaction } from "@life-tracker/db/schema/index";
import { categoryTree, todayInTimeZone } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import { rollUpSpend, spendByCategory, totalBudget } from "../lib/budget-spend";
import { loadCategoryMonthly, monthKeySchema, monthRange, spendColumns } from "../lib/budget-spend-sql";
import { getUserTimezone } from "../lib/user-timezone";

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
   * Every category for a month, as its tree (each parent followed by its
   * Subcategories, KOI-337), with its limit (null = not budgeted) and spend
   * (non-excluded expenses, by the bank's calendar month; a parent's includes
   * its Subcategories'), plus the month's Total Budget and the spend it covers.
   */
  forMonth: protectedProcedure
    .input(z.object({ monthKey: monthKeySchema }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const categories = await db
        .select({
          id: category.id,
          name: category.name,
          parentId: category.parentId,
          color: category.color,
          icon: category.icon,
        })
        .from(category)
        .where(eq(category.userId, userId))
        .orderBy(category.sortOrder, category.name);
      const limits = await db
        .select({ categoryId: budget.categoryId, limitAmount: budget.limitAmount })
        .from(budget)
        .where(and(eq(budget.userId, userId), eq(budget.monthKey, input.monthKey)));
      const txns = await db
        .select(spendColumns)
        .from(transaction)
        .where(and(eq(transaction.userId, userId), ...monthRange(input.monthKey, input.monthKey)));

      const spent = rollUpSpend(spendByCategory(txns, input.monthKey), categories);
      const limitById = new Map(limits.map((l) => [l.categoryId, l.limitAmount]));
      const rows = categoryTree(categories).map((c) => {
        const limit = limitById.get(c.id) ?? null;
        const categorySpent = spent.get(c.id) ?? 0;
        return {
          categoryId: c.id,
          categoryName: c.name,
          parentId: c.parentId,
          color: c.color,
          tint: c.tint,
          icon: c.icon,
          limit,
          spent: categorySpent,
          overspent: limit !== null && categorySpent > limit,
        };
      });
      const total = totalBudget(
        limits.map((l) => ({ ...l, spent: spent.get(l.categoryId) ?? 0 })),
        categories,
      );
      return { categories: rows, total };
    }),

  /**
   * One category's spend (a parent's including its Subcategories') and limit
   * for the `months` months ending at `monthKey`.
   */
  history: protectedProcedure
    .input(
      z.object({
        categoryId: z.string().uuid(),
        monthKey: monthKeySchema,
        months: z.number().int().min(1).max(24).default(6),
      }),
    )
    .query(({ ctx, input }) => loadCategoryMonthly(ctx.session.user.id, input.categoryId, input.monthKey, input.months)),

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
