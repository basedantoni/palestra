import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { category, transaction } from "@life-tracker/db/schema/index";

import { protectedProcedure, router } from "../index";
import { UNCATEGORIZED } from "../lib/category-spend";

type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Asserts the user owns a custom category. Built-in (seeded) categories are
 * locked: seeding and PFC auto-assignment match them by name, so renaming or
 * deleting one would make the next sync re-create it under the original name.
 */
async function ownedCustomCategory(conn: Db | Tx, userId: string, id: string): Promise<void> {
  const [row] = await conn
    .select({ id: category.id, isSystem: category.isSystem })
    .from(category)
    .where(and(eq(category.id, id), eq(category.userId, userId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
  if (row.isSystem) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Built-in categories can't be renamed or deleted" });
  }
}

const categoryName = z.string().trim().min(1).max(60);

/**
 * "Uncategorized" means no category, so a real category of that name would
 * show up as a second Uncategorized (KOI-301). A plain TRPCError, not a zod
 * refine, so the client gets a readable message.
 */
function assertNameNotReserved(name: string): void {
  if (name.toLowerCase() === UNCATEGORIZED.toLowerCase()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `"${UNCATEGORIZED}" is reserved for transactions with no category`,
    });
  }
}

export const categoriesRouter = router({
  /** The user's categories, with how many transactions each holds. */
  list: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: category.id,
        name: category.name,
        isSystem: category.isSystem,
        transactionCount: sql<number>`count(${transaction.id})::int`,
      })
      .from(category)
      .leftJoin(transaction, eq(transaction.categoryId, category.id))
      .where(eq(category.userId, ctx.session.user.id))
      .groupBy(category.id)
      .orderBy(category.name);
  }),

  create: protectedProcedure
    .input(z.object({ name: categoryName }))
    .mutation(async ({ ctx, input }) => {
      assertNameNotReserved(input.name);
      const id = randomUUID();
      await db
        .insert(category)
        .values({ id, userId: ctx.session.user.id, name: input.name, isSystem: false })
        .onConflictDoNothing();
      return { id };
    }),

  /** Rename a custom category. Built-ins are locked (see `ownedCustomCategory`). */
  rename: protectedProcedure
    .input(z.object({ id: z.string().uuid(), name: categoryName }))
    .mutation(async ({ ctx, input }) => {
      assertNameNotReserved(input.name);
      const userId = ctx.session.user.id;
      await ownedCustomCategory(db, userId, input.id);
      await db
        .update(category)
        .set({ name: input.name })
        .where(and(eq(category.id, input.id), eq(category.userId, userId)));
      return { ok: true };
    }),

  /**
   * Delete a custom category. With `moveToCategoryId`, its transactions move
   * to that (owned) category first; otherwise they become Uncategorized. Its
   * budgets are removed by the FK cascade.
   */
  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid(), moveToCategoryId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (input.moveToCategoryId === input.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Can't move transactions into the category being deleted" });
      }
      await db.transaction(async (tx) => {
        await ownedCustomCategory(tx, userId, input.id);
        if (input.moveToCategoryId) {
          const [target] = await tx
            .select({ id: category.id })
            .from(category)
            .where(and(eq(category.id, input.moveToCategoryId), eq(category.userId, userId)))
            .limit(1);
          if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Target category not found" });
          await tx
            .update(transaction)
            .set({ categoryId: target.id })
            .where(and(eq(transaction.userId, userId), eq(transaction.categoryId, input.id)));
        }
        await tx.delete(category).where(and(eq(category.id, input.id), eq(category.userId, userId)));
      });
      return { ok: true };
    }),
});
