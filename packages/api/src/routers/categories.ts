import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { category, transaction } from "@life-tracker/db/schema/index";
import { CATEGORY_COLORS, CATEGORY_ICONS, categoryTree, nextCategoryColor } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import { type Conn, ownedCategory } from "../lib/category-rules-db";
import { UNCATEGORIZED } from "../lib/category-spend";

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

/**
 * Checks that `id` may be filed under `parentId` (KOI-337): the parent is the
 * user's own and top-level, and `id` has no Subcategories of its own, so the
 * tree stays two levels deep.
 * ponytail: no row locks, so two concurrent moves (A under B, B under C) could
 * nest three deep; lock both rows FOR UPDATE if categories gain shared editors.
 */
async function assertCanFileUnder(conn: Conn, userId: string, id: string, parentId: string): Promise<void> {
  if (parentId === id) throw new TRPCError({ code: "BAD_REQUEST", message: "A category can't be its own parent" });
  const parent = await ownedCategory(conn, userId, parentId, "Parent category not found");
  if (parent.parentId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A Subcategory can't have Subcategories" });
  }
  const [subcategory] = await conn
    .select({ id: category.id })
    .from(category)
    .where(eq(category.parentId, id))
    .limit(1);
  if (subcategory) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A category with Subcategories can't be moved under another" });
  }
}

export const categoriesRouter = router({
  /**
   * The user's categories as their tree in manual order (each parent followed
   * by its Subcategories, `tint` set on those), with how many transactions each holds.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        id: category.id,
        name: category.name,
        parentId: category.parentId,
        color: category.color,
        icon: category.icon,
        isSystem: category.isSystem,
        transactionCount: sql<number>`count(${transaction.id})::int`,
      })
      .from(category)
      .leftJoin(transaction, eq(transaction.categoryId, category.id))
      .where(eq(category.userId, ctx.session.user.id))
      .groupBy(category.id)
      .orderBy(category.sortOrder, category.name);
    return categoryTree(rows);
  }),

  /** A new category goes last, in the least-used palette color. */
  create: protectedProcedure
    .input(z.object({ name: categoryName }))
    .mutation(async ({ ctx, input }) => {
      assertNameNotReserved(input.name);
      const userId = ctx.session.user.id;
      const existing = await db
        .select({ color: category.color, sortOrder: category.sortOrder })
        .from(category)
        .where(eq(category.userId, userId));
      const id = randomUUID();
      await db
        .insert(category)
        .values({
          id,
          userId,
          name: input.name,
          isSystem: false,
          color: nextCategoryColor(existing.map((c) => c.color)),
          sortOrder: Math.max(-1, ...existing.map((c) => c.sortOrder)) + 1,
        })
        .onConflictDoNothing();
      return { id };
    }),

  /**
   * Rename, recolor, set or clear the icon of, or set or clear the parent of
   * any owned category, seeded or custom. A Subcategory stores no color: filing
   * one under a parent drops its own, and one moved back to top level takes its
   * old parent's unless given a color.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: categoryName.optional(),
        color: z.enum(CATEGORY_COLORS).optional(),
        icon: z.enum(CATEGORY_ICONS).nullable().optional(),
        parentId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;
      if (changes.name !== undefined) assertNameNotReserved(changes.name);
      const userId = ctx.session.user.id;
      await db.transaction(async (tx) => {
        const current = await ownedCategory(tx, userId, id);
        const willBeSubcategory = changes.parentId === undefined ? !!current.parentId : !!changes.parentId;
        if (changes.color && willBeSubcategory) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A Subcategory takes its parent's color" });
        }
        const set: Partial<typeof category.$inferInsert> = { ...changes };
        if (changes.parentId) {
          await assertCanFileUnder(tx, userId, id, changes.parentId);
          set.color = null;
        } else if (changes.parentId === null && current.parentId) {
          set.color = changes.color ?? (await ownedCategory(tx, userId, current.parentId)).color;
        }
        if (Object.values(set).every((v) => v === undefined)) return;
        await tx
          .update(category)
          .set(set)
          .where(and(eq(category.id, id), eq(category.userId, userId)));
      });
      return { ok: true };
    }),

  /**
   * Set the manual order: `ids` is every one of the user's categories, first
   * to last. A list missing or adding any is rejected, so a stale screen can't
   * scramble the order.
   */
  reorder: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await db.transaction(async (tx) => {
        const owned = await tx.select({ id: category.id }).from(category).where(eq(category.userId, userId));
        const ownedIds = new Set(owned.map((c) => c.id));
        if (new Set(input.ids).size !== input.ids.length || input.ids.length !== ownedIds.size || !input.ids.every((id) => ownedIds.has(id))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The category list changed; reload and try again" });
        }
        for (const [sortOrder, id] of input.ids.entries()) {
          await tx
            .update(category)
            .set({ sortOrder })
            .where(and(eq(category.id, id), eq(category.userId, userId)));
        }
      });
      return { ok: true };
    }),

  /**
   * Delete any owned category. With `moveToCategoryId`, its transactions move
   * to that (owned) category first; otherwise they become Uncategorized. Its
   * budgets are removed by the FK cascade, and a Bank Category mapped to it
   * becomes unmapped (SET NULL). Its Subcategories move up to top level in
   * its color.
   */
  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid(), moveToCategoryId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (input.moveToCategoryId === input.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Can't move transactions into the category being deleted" });
      }
      await db.transaction(async (tx) => {
        const deleted = await ownedCategory(tx, userId, input.id);
        await tx
          .update(category)
          .set({ parentId: null, color: deleted.color })
          .where(and(eq(category.userId, userId), eq(category.parentId, input.id)));
        if (input.moveToCategoryId) {
          await ownedCategory(tx, userId, input.moveToCategoryId, "Target category not found");
          await tx
            .update(transaction)
            .set({ categoryId: input.moveToCategoryId })
            .where(and(eq(transaction.userId, userId), eq(transaction.categoryId, input.id)));
        }
        await tx.delete(category).where(and(eq(category.id, input.id), eq(category.userId, userId)));
      });
      return { ok: true };
    }),
});
