import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { category, financialAccount, transaction } from "@life-tracker/db/schema/index";

import { resolvePeriodBounds, todayInTimeZone } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import { dateBoundConditions, periodSchema } from "../lib/transaction-period-sql";
import { defaultCategoryId } from "../lib/category-rules";
import { effectiveFlow } from "../lib/transaction-flow";
import { getUserTimezone } from "../lib/user-timezone";

const filtersSchema = z.object({
  period: periodSchema.default({ kind: "all" }),
  accountIds: z.array(z.string().uuid()).max(50).default([]),
  /** A category, or null for Uncategorized; omitted = every category. */
  categoryId: z.string().uuid().nullable().optional(),
});

/** WHERE conditions for the caller's filtered transactions; "today" (for shortcut periods) is the user's local date. */
async function filterConditions(userId: string, filters: z.infer<typeof filtersSchema>): Promise<SQL[]> {
  const today = todayInTimeZone(new Date(), await getUserTimezone(userId));
  const conds: SQL[] = [eq(transaction.userId, userId), ...dateBoundConditions(resolvePeriodBounds(filters.period, today))];
  if (filters.accountIds.length > 0) conds.push(inArray(transaction.accountId, filters.accountIds));
  if (filters.categoryId === null) conds.push(isNull(transaction.categoryId));
  else if (filters.categoryId) conds.push(eq(transaction.categoryId, filters.categoryId));
  return conds;
}

/** "<ISO date>|<uuid>" — the last row of the previous page. */
const cursorSchema = z.string().transform((value, ctx) => {
  const [iso, id] = value.split("|");
  const date = new Date(iso ?? "");
  if (!id || Number.isNaN(date.getTime()) || !z.string().uuid().safeParse(id).success) {
    ctx.addIssue({ code: "custom", message: "Invalid cursor" });
    return z.NEVER;
  }
  return { date, id };
});

export const transactionsRouter = router({
  /** Paginated transaction feed with optional period / account / category filters. */
  list: protectedProcedure
    .input(
      filtersSchema.extend({
        limit: z.number().int().min(1).max(200).default(50),
        /** Opaque keyset cursor from the previous page's `nextCursor`. */
        cursor: cursorSchema.nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conds = await filterConditions(ctx.session.user.id, input);
      if (input.cursor) {
        // Keyset on (date, id) desc: stable while syncs insert newer rows.
        conds.push(
          or(
            lt(transaction.date, input.cursor.date),
            and(eq(transaction.date, input.cursor.date), lt(transaction.id, input.cursor.id)),
          )!,
        );
      }

      const rows = await db
        .select({
          id: transaction.id,
          date: transaction.date,
          name: transaction.name,
          merchantName: transaction.merchantName,
          amount: transaction.amount,
          flow: transaction.flow,
          flowOverridden: transaction.flowOverridden,
          pending: transaction.pending,
          excluded: transaction.excluded,
          note: transaction.note,
          transferPairId: transaction.transferPairId,
          categoryId: transaction.categoryId,
          categoryOverridden: transaction.categoryOverridden,
          categoryName: category.name,
          accountId: transaction.accountId,
          accountName: financialAccount.name,
          isoCurrencyCode: transaction.isoCurrencyCode,
        })
        .from(transaction)
        .leftJoin(category, eq(category.id, transaction.categoryId))
        .innerJoin(financialAccount, eq(financialAccount.id, transaction.accountId))
        .where(and(...conds))
        .orderBy(desc(transaction.date), desc(transaction.id))
        .limit(input.limit + 1); // one extra row tells us whether a next page exists

      const items = rows.slice(0, input.limit);
      const last = items.at(-1);
      const nextCursor =
        rows.length > input.limit && last ? `${last.date.toISOString()}|${last.id}` : null;
      return { items, nextCursor };
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

  /** Pick a category by hand; it becomes a Manual Category, even when null (ADR 0004). */
  setCategory: protectedProcedure
    .input(z.object({ id: z.string().uuid(), categoryId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(transaction)
        .set({ categoryId: input.categoryId, categoryOverridden: true })
        .where(and(eq(transaction.id, input.id), eq(transaction.userId, ctx.session.user.id)));
      return { ok: true };
    }),

  /** Reset to automatic: clear the Manual Category and restore the Default Category. */
  resetCategory: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const owned = and(eq(transaction.id, input.id), eq(transaction.userId, userId));
      const [row] = await db
        .select({ plaidCategoryPrimary: transaction.plaidCategoryPrimary })
        .from(transaction)
        .where(owned)
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });

      const categories = await db
        .select({ id: category.id, name: category.name })
        .from(category)
        .where(eq(category.userId, userId));
      const categoryId = defaultCategoryId(
        row.plaidCategoryPrimary,
        new Map(categories.map((c) => [c.name, c.id])),
      );
      await db.update(transaction).set({ categoryId, categoryOverridden: false }).where(owned);
      return { ok: true };
    }),

  /**
   * Correct a transaction's flow; null resets to automatic (ADR 0001). The
   * override flag makes the Plaid sync upsert leave `flow` alone.
   */
  setFlow: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        flow: z.enum(["income", "expense", "transfer"]).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const owned = and(eq(transaction.id, input.id), eq(transaction.userId, ctx.session.user.id));
      await db.transaction(async (tx) => {
        // Locked so a concurrent sync/match can't change pending or the pair between read and write.
        const [row] = await tx
          .select({
            pending: transaction.pending,
            plaidCategoryPrimary: transaction.plaidCategoryPrimary,
            transferPairId: transaction.transferPairId,
          })
          .from(transaction)
          .where(owned)
          .limit(1)
          .for("update");
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
        // Posting issues a new Plaid id, so an override on a pending row would be lost.
        if (row.pending) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Pending transactions can't be changed until they post",
          });
        }

        const flow = effectiveFlow(input.flow, row.plaidCategoryPrimary);
        await tx
          .update(transaction)
          .set({ flow, flowOverridden: input.flow !== null })
          .where(owned);
        // A leg that is no longer a transfer breaks the Transfer Pair; the other leg stays an unpaired transfer.
        const { transferPairId } = row;
        if (transferPairId && flow !== "transfer") {
          await tx
            .update(transaction)
            .set({ transferPairId: null })
            .where(
              and(
                eq(transaction.transferPairId, transferPairId),
                eq(transaction.userId, ctx.session.user.id),
              ),
            );
        }
      });
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
