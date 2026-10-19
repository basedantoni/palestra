import { z } from "zod";

import { db } from "@life-tracker/db";
import { bankCategoryMapping } from "@life-tracker/db/schema/index";

import { protectedProcedure, router } from "../index";
import { bankCategoryRecategorizations } from "../lib/rules";
import {
  applyRecategorizations,
  loadBankCategoryMapping,
  loadBankCategoryTransactions,
  loadMatchableRules,
  ownedCategory,
  remapMayCategorize,
} from "../lib/rules-db";
import { PFC_PRIMARIES } from "../lib/category-seed";

/**
 * Bank Category mapping (KOI-335): which category each Bank Category gives a
 * transaction as its Default Category, or none (Uncategorized).
 */
export const bankCategoriesRouter = router({
  /** Every Bank Category with its mapped category, null when unmapped. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const mapping = await loadBankCategoryMapping(db, ctx.session.user.id);
    return PFC_PRIMARIES.map((bankCategory) => ({ bankCategory, categoryId: mapping.get(bankCategory) ?? null }));
  }),

  /**
   * Map a Bank Category to an owned category (or none), then re-resolve the
   * caller's automatic rows of it as a fresh sync would: rules still win, and a
   * Manual Category is never touched.
   */
  setMapping: protectedProcedure
    .input(z.object({ bankCategory: z.enum(PFC_PRIMARIES), categoryId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { bankCategory, categoryId } = input;
      return db.transaction(async (tx) => {
        if (categoryId) await ownedCategory(tx, userId, categoryId);
        // Read (and so seed) first, so a never-synced user's choice isn't taken as their whole mapping.
        const mapping = new Map(await loadBankCategoryMapping(tx, userId));
        await tx
          .insert(bankCategoryMapping)
          .values({ userId, pfcPrimary: bankCategory, categoryId })
          .onConflictDoUpdate({ target: [bankCategoryMapping.userId, bankCategoryMapping.pfcPrimary], set: { categoryId } });
        mapping.set(bankCategory, categoryId);

        const changes = bankCategoryRecategorizations(
          await loadBankCategoryTransactions(tx, userId, bankCategory),
          await loadMatchableRules(tx, userId),
          mapping,
        );
        return { applied: await applyRecategorizations(tx, userId, changes, remapMayCategorize) };
      });
    }),
});
