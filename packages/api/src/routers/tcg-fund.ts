/**
 * TCG Card Fund (KOI-312, ADR 0005): per-user settings and the fund read.
 * The fund is derived from the Cards category's finance budgets and
 * transactions; TCG keeps no spending log.
 */
import { and, eq, gte, lte } from "drizzle-orm";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { budget, category, tcgSettings, transaction } from "@life-tracker/db/schema/index";
import { todayInTimeZone } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import { cardFund } from "../lib/card-fund";
import { getUserTimezone } from "../lib/user-timezone";
import { monthKeySchema, monthRange, spendColumns } from "./budgets";

export const tcgFundRouter = router({
  /** The caller's settings (null until saved) and Card Fund (null without a Cards category). */
  get: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const [settings = null] = await db
      .select({ cardsCategoryId: tcgSettings.cardsCategoryId, startMonth: tcgSettings.startMonth })
      .from(tcgSettings)
      .where(eq(tcgSettings.userId, userId))
      .limit(1);
    const categoryId = settings?.cardsCategoryId;
    if (!settings || !categoryId) return { settings, fund: null };

    const { startMonth } = settings;
    const currentMonth = todayInTimeZone(new Date(), await getUserTimezone(userId)).slice(0, 7);
    const limits = await db
      .select({ monthKey: budget.monthKey, limitAmount: budget.limitAmount })
      .from(budget)
      .where(
        and(
          eq(budget.userId, userId),
          eq(budget.categoryId, categoryId),
          gte(budget.monthKey, startMonth),
          lte(budget.monthKey, currentMonth),
        ),
      );
    // This month's spend is shown even when the start month is still ahead.
    const from = startMonth < currentMonth ? startMonth : currentMonth;
    const transactions = await db
      .select(spendColumns)
      .from(transaction)
      .where(and(eq(transaction.userId, userId), eq(transaction.categoryId, categoryId), ...monthRange(from, currentMonth)));

    return {
      settings,
      fund: { currentMonth, ...cardFund({ categoryId, limits, transactions, startMonth, currentMonth }) },
    };
  }),

  saveSettings: protectedProcedure
    .input(z.object({ cardsCategoryId: z.string().uuid(), startMonth: monthKeySchema }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const [owned] = await db
        .select({ id: category.id })
        .from(category)
        .where(and(eq(category.id, input.cardsCategoryId), eq(category.userId, userId)))
        .limit(1);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });

      await db
        .insert(tcgSettings)
        .values({ userId, ...input })
        .onConflictDoUpdate({ target: tcgSettings.userId, set: input });
    }),
});
