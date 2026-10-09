import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { category, categoryRule } from "@life-tracker/db/schema/index";

import { protectedProcedure, router } from "../index";
import {
  DUPLICATE_PATTERN_REASON,
  MAX_PATTERN_LENGTH,
  MIN_PATTERN_LENGTH,
  type MatchableRule,
  validatePattern,
} from "../lib/category-rules";
import { type Conn, applyRecategorizations, loadMatchableRules, planRuleApply } from "../lib/category-rules-db";

const ruleInput = z.object({
  pattern: z.string().max(MAX_PATTERN_LENGTH),
  categoryId: z.string().uuid(),
});

async function assertOwnedCategory(conn: Conn, userId: string, categoryId: string): Promise<void> {
  const [owned] = await conn
    .select({ id: category.id })
    .from(category)
    .where(and(eq(category.id, categoryId), eq(category.userId, userId)))
    .limit(1);
  if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
}

function assertOwnedRule(rules: readonly MatchableRule[], ruleId: string): void {
  if (!rules.some((r) => r.id === ruleId)) throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * Category Rules (KOI-298/299): user-defined Patterns that categorize
 * transactions at Plaid sync and, when asked, retroactively. Applying is a
 * one-shot write (ADR 0004): deleting or editing a rule without apply leaves
 * past transactions as they are. Deleting a category cascades to its rules.
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

  /** How many non-manual transactions would change if this rule were saved (new, or as `ruleId`). */
  preview: protectedProcedure
    .input(ruleInput.extend({ ruleId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const pattern = input.pattern.trim();
      if (pattern.length < MIN_PATTERN_LENGTH) return { matchCount: 0 };
      await assertOwnedCategory(db, userId, input.categoryId);
      const rules = await loadMatchableRules(db, userId);
      if (input.ruleId) assertOwnedRule(rules, input.ruleId);

      const changes = await planRuleApply(db, userId, rules, {
        id: input.ruleId ?? randomUUID(),
        pattern,
        categoryId: input.categoryId,
      });
      return { matchCount: changes.length };
    }),

  create: protectedProcedure
    .input(ruleInput.extend({ applyToExisting: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      // Rules are read inside the transaction so the apply sees the set the save lands in.
      return db.transaction(async (tx) => {
        await assertOwnedCategory(tx, userId, input.categoryId);
        const rules = await loadMatchableRules(tx, userId);
        const valid = validatePattern(input.pattern, rules);
        if (!valid.ok) throw new TRPCError({ code: "BAD_REQUEST", message: valid.reason });

        // The unique (user, lower(pattern)) index catches a concurrent duplicate.
        const [saved] = await tx
          .insert(categoryRule)
          .values({ id: randomUUID(), userId, pattern: valid.pattern, categoryId: input.categoryId })
          .onConflictDoNothing()
          .returning({
            id: categoryRule.id,
            pattern: categoryRule.pattern,
            categoryId: categoryRule.categoryId,
            createdAt: categoryRule.createdAt,
          });
        if (!saved) throw new TRPCError({ code: "BAD_REQUEST", message: DUPLICATE_PATTERN_REASON });

        const applied = input.applyToExisting
          ? await applyRecategorizations(tx, userId, await planRuleApply(tx, userId, rules, saved))
          : 0;
        return { rule: saved, applied };
      });
    }),

  update: protectedProcedure
    .input(ruleInput.extend({ id: z.string().uuid(), applyToExisting: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      try {
        return await db.transaction(async (tx) => {
          await assertOwnedCategory(tx, userId, input.categoryId);
          const rules = await loadMatchableRules(tx, userId);
          assertOwnedRule(rules, input.id);
          const valid = validatePattern(input.pattern, rules, input.id);
          if (!valid.ok) throw new TRPCError({ code: "BAD_REQUEST", message: valid.reason });

          const rule = { id: input.id, pattern: valid.pattern, categoryId: input.categoryId };
          const [saved] = await tx
            .update(categoryRule)
            .set({ pattern: rule.pattern, categoryId: rule.categoryId })
            .where(and(eq(categoryRule.id, rule.id), eq(categoryRule.userId, userId)))
            .returning({ id: categoryRule.id });
          if (!saved) throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });

          const applied = input.applyToExisting
            ? await applyRecategorizations(tx, userId, await planRuleApply(tx, userId, rules, rule))
            : 0;
          return { rule, applied };
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw new TRPCError({ code: "BAD_REQUEST", message: DUPLICATE_PATTERN_REASON });
        throw err;
      }
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
