import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { category, categoryRule } from "@life-tracker/db/schema/index";

import { protectedProcedure, router } from "../index";
import { MAX_PATTERN_LENGTH, validatePattern } from "../lib/category-rules";

/**
 * Category Rules (KOI-298): user-defined Patterns that categorize new
 * transactions at Plaid sync. Deleting a rule leaves existing transactions as
 * they are; deleting a category cascades to its rules.
 */
export const categoryRulesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: categoryRule.id,
        pattern: categoryRule.pattern,
        categoryId: categoryRule.categoryId,
        categoryName: category.name,
        createdAt: categoryRule.createdAt,
      })
      .from(categoryRule)
      .innerJoin(category, eq(category.id, categoryRule.categoryId))
      .where(eq(categoryRule.userId, ctx.session.user.id))
      .orderBy(desc(categoryRule.createdAt));
  }),

  create: protectedProcedure
    .input(z.object({ pattern: z.string().max(MAX_PATTERN_LENGTH), categoryId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const [owned] = await db
        .select({ id: category.id })
        .from(category)
        .where(and(eq(category.id, input.categoryId), eq(category.userId, userId)))
        .limit(1);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });

      const existing = await db
        .select({ id: categoryRule.id, pattern: categoryRule.pattern })
        .from(categoryRule)
        .where(eq(categoryRule.userId, userId));
      const valid = validatePattern(input.pattern, existing);
      if (!valid.ok) throw new TRPCError({ code: "BAD_REQUEST", message: valid.reason });

      // The unique (user, lower(pattern)) index catches a concurrent duplicate.
      const [row] = await db
        .insert(categoryRule)
        .values({ id: randomUUID(), userId, pattern: valid.pattern, categoryId: input.categoryId })
        .onConflictDoNothing()
        .returning({ id: categoryRule.id });
      if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: "A rule with this pattern already exists" });
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .delete(categoryRule)
        .where(and(eq(categoryRule.id, input.id), eq(categoryRule.userId, ctx.session.user.id)))
        .returning({ id: categoryRule.id });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
      return { ok: true };
    }),
});
