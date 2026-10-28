import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { tcgArtwork, tcgMarketplaceProduct } from "@life-tracker/db/schema/index";

import { adminProcedure, router } from "../index";

const p = tcgMarketplaceProduct;

/**
 * The admin's fixes to the Marketplace Product → Artwork matcher (KOI-368). A manual row is never
 * touched by the matcher; it takes effect for past days on the next `market.derive` replay.
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
});
