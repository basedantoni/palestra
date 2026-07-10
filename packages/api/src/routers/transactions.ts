import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { category, financialAccount, transaction } from "@life-tracker/db/schema/index";

import { protectedProcedure, router } from "../index";

export const transactionsRouter = router({
  /** Paginated transaction feed with optional date / account / category filters. */
  list: protectedProcedure
    .input(
      z.object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        accountId: z.string().uuid().optional(),
        categoryId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conds: SQL[] = [eq(transaction.userId, ctx.session.user.id)];
      if (input.from) conds.push(gte(transaction.date, input.from));
      if (input.to) conds.push(lte(transaction.date, input.to));
      if (input.accountId) conds.push(eq(transaction.accountId, input.accountId));
      if (input.categoryId) conds.push(eq(transaction.categoryId, input.categoryId));

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
