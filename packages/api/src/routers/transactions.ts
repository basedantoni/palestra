import { and, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { category, financialAccount, transaction } from "@life-tracker/db/schema/index";

import {
  TRANSACTION_PERIOD_PRESETS,
  resolvePeriodBounds,
  todayInTimeZone,
} from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import { getUserTimezone } from "../lib/user-timezone";

const periodSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("month"), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
  z.object({ kind: z.literal("preset"), preset: z.enum(TRANSACTION_PERIOD_PRESETS) }),
  z.object({ kind: z.literal("all") }),
]);

const filtersSchema = z.object({
  period: periodSchema.default({ kind: "all" }),
  accountIds: z.array(z.string().uuid()).max(50).default([]),
  categoryId: z.string().uuid().optional(),
});

/**
 * WHERE conditions for the caller's filtered transactions. Plaid dates are
 * stored as UTC midnight of the bank's calendar date, so bounds compare whole
 * UTC days; "today" (for shortcut periods) is the user's local date.
 */
async function filterConditions(userId: string, filters: z.infer<typeof filtersSchema>): Promise<SQL[]> {
  const today = todayInTimeZone(new Date(), await getUserTimezone(userId));
  const { from, to } = resolvePeriodBounds(filters.period, today);

  const conds: SQL[] = [eq(transaction.userId, userId)];
  if (from) conds.push(gte(transaction.date, new Date(`${from}T00:00:00.000Z`)));
  if (to) {
    const dayAfter = new Date(`${to}T00:00:00.000Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    conds.push(lt(transaction.date, dayAfter));
  }
  if (filters.accountIds.length > 0) conds.push(inArray(transaction.accountId, filters.accountIds));
  if (filters.categoryId) conds.push(eq(transaction.categoryId, filters.categoryId));
  return conds;
}

export const transactionsRouter = router({
  /** Paginated transaction feed with optional period / account / category filters. */
  list: protectedProcedure
    .input(
      filtersSchema.extend({
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conds = await filterConditions(ctx.session.user.id, input);

      return db
        .select({
          id: transaction.id,
          date: transaction.date,
          name: transaction.name,
          merchantName: transaction.merchantName,
          amount: transaction.amount,
          flow: transaction.flow,
          pending: transaction.pending,
          excluded: transaction.excluded,
          note: transaction.note,
          transferPairId: transaction.transferPairId,
          categoryId: transaction.categoryId,
          categoryName: category.name,
          accountId: transaction.accountId,
          accountName: financialAccount.name,
          isoCurrencyCode: transaction.isoCurrencyCode,
        })
        .from(transaction)
        .leftJoin(category, eq(category.id, transaction.categoryId))
        .innerJoin(financialAccount, eq(financialAccount.id, transaction.accountId))
        .where(and(...conds))
        .orderBy(desc(transaction.date))
        .limit(input.limit)
        .offset(input.offset);
    }),

  /**
   * Totals for the filtered feed: how many transactions match, and expense
   * spend (non-excluded, flow = expense — the same rule budgets use).
   */
  summary: protectedProcedure.input(filtersSchema).query(async ({ ctx, input }) => {
    const conds = await filterConditions(ctx.session.user.id, input);
    const [row] = await db
      .select({
        count: sql<number>`count(*)::int`,
        spent: sql<number | null>`sum(${transaction.amount}) filter (where ${transaction.flow} = 'expense' and not ${transaction.excluded})`,
      })
      .from(transaction)
      .where(and(...conds));
    return { count: row?.count ?? 0, spent: Number(row?.spent ?? 0) };
  }),

  setCategory: protectedProcedure
    .input(z.object({ id: z.string().uuid(), categoryId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(transaction)
        .set({ categoryId: input.categoryId })
        .where(and(eq(transaction.id, input.id), eq(transaction.userId, ctx.session.user.id)));
      return { ok: true };
    }),

  setExcluded: protectedProcedure
    .input(z.object({ id: z.string().uuid(), excluded: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(transaction)
        .set({ excluded: input.excluded })
        .where(and(eq(transaction.id, input.id), eq(transaction.userId, ctx.session.user.id)));
      return { ok: true };
    }),

  setNote: protectedProcedure
    .input(z.object({ id: z.string().uuid(), note: z.string().max(500).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(transaction)
        .set({ note: input.note })
        .where(and(eq(transaction.id, input.id), eq(transaction.userId, ctx.session.user.id)));
      return { ok: true };
    }),
});
