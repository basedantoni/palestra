import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { tcgArtwork, tcgCopy, tcgMarketplaceProduct, tcgOffer, tcgPrinting } from "@life-tracker/db/schema/index";
import { TCG_LANGUAGE_NAME } from "@life-tracker/shared";

import { adminProcedure, router } from "../index";

const p = tcgMarketplaceProduct;

/**
 * The admin's fixes to the Marketplace Product → Artwork matcher (KOI-368). A manual row is never
 * touched by the matcher; it takes effect for past days on the next `market.derive` replay. Also
 * the cleanup of phantom Printings the CardTrader capture created (KOI-372).
 */
export const marketAdminRouter = router({
  /** The Marketplace Products the matcher couldn't place: no Artwork, and not set by hand. */
  unmatchedProducts: adminProcedure.query(() =>
    db
      .select({ id: p.id, marketplace: p.marketplace, externalId: p.externalId, name: p.name, number: p.number, set: p.set, reason: p.reason })
      .from(p)
      .where(and(isNull(p.variantId), ne(p.method, "manual")))
      .orderBy(asc(p.marketplace), asc(p.set), asc(p.number), asc(p.externalId)),
  ),

  /** Match a product to an Artwork by hand, or (`variantId: null`) mark it "not an Artwork". */
  setManualMatch: adminProcedure
    .input(z.object({ id: z.number().int(), variantId: z.string().trim().min(1).max(40).nullable() }))
    .mutation(async ({ input: { id, variantId } }) => {
      if (variantId !== null) {
        const [artwork] = await db.select({ variantId: tcgArtwork.variantId }).from(tcgArtwork).where(eq(tcgArtwork.variantId, variantId));
        if (!artwork) throw new TRPCError({ code: "BAD_REQUEST", message: `No Artwork ${variantId}` });
      }
      const [updated] = await db
        .update(p)
        .set({ variantId, method: "manual", confidence: null, reason: null, matchedAt: new Date() })
        .where(eq(p.id, id))
        .returning({ id: p.id, variantId: p.variantId, method: p.method });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Marketplace Product not found" });
      return updated;
    }),

  /**
   * Delete a phantom Simplified Chinese or Korean Printing that CardTrader Listings created
   * (KOI-372), with its Market Prices. Refused while a Copy or an Offer is of it; Japanese and
   * English Printings come from the catalog import and are never deleted here.
   */
  deletePrinting: adminProcedure
    .input(z.object({ variantId: z.string().trim().min(1).max(40), language: z.enum(["zh", "ko"]) }))
    .mutation(async ({ input: { variantId, language } }) => {
      const ids = (
        await db
          .select({ id: tcgPrinting.id })
          .from(tcgPrinting)
          .where(and(eq(tcgPrinting.variantId, variantId), eq(tcgPrinting.language, language)))
      ).map((r) => r.id);
      const name = `${TCG_LANGUAGE_NAME[language]} Printing of ${variantId}`;
      if (ids.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: `No ${name}` });
      const [[copy], [offer]] = await Promise.all([
        db.select({ id: tcgCopy.id }).from(tcgCopy).where(inArray(tcgCopy.printingId, ids)).limit(1),
        db.select({ id: tcgOffer.id }).from(tcgOffer).where(inArray(tcgOffer.printingId, ids)).limit(1),
      ]);
      if (copy || offer) {
        throw new TRPCError({ code: "CONFLICT", message: `The ${name} has ${copy ? "a Copy" : "an Offer"}` });
      }
      // A Copy or Offer added since the check still blocks it: their foreign keys don't cascade.
      await db.delete(tcgPrinting).where(inArray(tcgPrinting.id, ids));
      return { deleted: ids.length };
    }),
});
