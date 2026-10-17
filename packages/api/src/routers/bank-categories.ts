import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { bankCategoryMapping, category } from "@life-tracker/db/schema/index";

import { protectedProcedure, router } from "../index";
import { bankCategoryRecategorizations } from "../lib/category-rules";
import {
  applyRecategorizations,
  ensureSeeded,
  loadBankCategoryMapping,
  loadBankCategoryTransactions,
  loadMatchableRules,
  remapMayCategorize,
} from "../lib/category-rules-db";
import { PFC_PRIMARIES } from "../lib/category-seed";

/**
 * Bank Category mapping (KOI-335): which category each Plaid PFC primary gives
 * a transaction as its Default Category, or none (Uncategorized).
 */
export const bankCategoriesRouter = router({
  /** Every PFC primary with its mapped category, null when unmapped. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const mapping = await loadBankCategoryMapping(db, ctx.session.user.id);
    return PFC_PRIMARIES.map((pfcPrimary) => ({ pfcPrimary, categoryId: mapping.get(pfcPrimary) ?? null }));
  }),

  /**
   * Map a Bank Category to an owned category (or none), then re-resolve the
   * caller's automatic rows of it as a fresh sync would: rules still win, and a
   * Manual Category is never touched.
   */
  setMapping: protectedProcedure
    .input(z.object({ pfcPrimary: z.enum(PFC_PRIMARIES), categoryId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { pfcPrimary, categoryId } = input;
      return db.transaction(async (tx) => {
        if (categoryId) {
          const [owned] = await tx
            .select({ id: category.id })
            .from(category)
            .where(and(eq(category.id, categoryId), eq(category.userId, userId)))
            .limit(1);
          if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
        }
        // Seed first, so a never-synced user's choice isn't later taken as "already seeded".
        const mapping = new Map(await ensureSeeded(tx, userId));
        await tx
          .insert(bankCategoryMapping)
          .values({ userId, pfcPrimary, categoryId })
          .onConflictDoUpdate({ target: [bankCategoryMapping.userId, bankCategoryMapping.pfcPrimary], set: { categoryId } });
        mapping.set(pfcPrimary, categoryId);

        const changes = bankCategoryRecategorizations(
          await loadBankCategoryTransactions(tx, userId, pfcPrimary),
          await loadMatchableRules(tx, userId),
          mapping,
        );
        return { applied: await applyRecategorizations(tx, userId, changes, remapMayCategorize) };
      });
    }),
});
