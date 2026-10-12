import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { tcgOffer, tcgPrinting, tcgWant } from "@life-tracker/db/schema/index";
import { TCG_LANGUAGE_NAME } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";

const terms = z.object({
  printingId: z.string().uuid(),
  /** Free text: a shop, Mercari, a local store. */
  seller: z.string().trim().min(1, "Seller is required").max(200),
  /** Delivered price (item + shipping + tax), USD. */
  price: z.number().positive().finite(),
  url: z.string().trim().url().max(2000).nullish(),
  seenOn: z.iso.date(),
});

type Want = Pick<typeof tcgWant.$inferSelect, "variantId" | "languages" | "status">;

/** Offers are shopping notes for an open Want; once it's ordered, fulfilled or dropped they're frozen. */
function assertOpen(want: Want) {
  if (want.status !== "open") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Offers can only change while the Want is open (this one is ${want.status})`,
    });
  }
}

/** The Printing must be of the Want's Artwork and in one of its accepted languages. */
async function assertPrintingFits(want: Want, printingId: string) {
  const [printing] = await db
    .select({ variantId: tcgPrinting.variantId, language: tcgPrinting.language })
    .from(tcgPrinting)
    .where(eq(tcgPrinting.id, printingId))
    .limit(1);
  if (!printing) throw new TRPCError({ code: "NOT_FOUND", message: "Printing not found" });
  if (printing.variantId !== want.variantId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That Printing is of another Artwork" });
  }
  if (!want.languages.includes(printing.language)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `This Want doesn't accept ${TCG_LANGUAGE_NAME[printing.language]} Printings`,
    });
  }
}

/** The caller's Offer (owned through its Want), with its Want's terms. */
async function ownedOffer(userId: string, id: string): Promise<Want & { boughtOfferId: string | null }> {
  const [offer] = await db
    .select({
      variantId: tcgWant.variantId,
      languages: tcgWant.languages,
      status: tcgWant.status,
      boughtOfferId: tcgWant.boughtOfferId,
    })
    .from(tcgOffer)
    .innerJoin(tcgWant, eq(tcgWant.id, tcgOffer.wantId))
    .where(and(eq(tcgOffer.id, id), eq(tcgWant.userId, userId)))
    .limit(1);
  if (!offer) throw new TRPCError({ code: "NOT_FOUND", message: "Offer not found" });
  return offer;
}

/** Offers (KOI-310): prices seen while shopping, recorded against an open Want. */
export const tcgOffersRouter = router({
  create: protectedProcedure.input(terms.extend({ wantId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [want] = await db
      .select({ variantId: tcgWant.variantId, languages: tcgWant.languages, status: tcgWant.status })
      .from(tcgWant)
      .where(and(eq(tcgWant.id, input.wantId), eq(tcgWant.userId, ctx.session.user.id)))
      .limit(1);
    if (!want) throw new TRPCError({ code: "NOT_FOUND", message: "Want not found" });
    assertOpen(want);
    await assertPrintingFits(want, input.printingId);

    const [created] = await db
      .insert(tcgOffer)
      .values({ ...input, url: input.url ?? null })
      .returning({ id: tcgOffer.id });
    return created!;
  }),

  update: protectedProcedure.input(terms.extend({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const { id, ...set } = input;
    const want = await ownedOffer(ctx.session.user.id, id);
    assertOpen(want);
    await assertPrintingFits(want, set.printingId);
    const [updated] = await db
      .update(tcgOffer)
      .set({ ...set, url: set.url ?? null })
      .where(eq(tcgOffer.id, id))
      .returning({ id: tcgOffer.id });
    if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Offer not found" });
    return updated;
  }),

  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const want = await ownedOffer(ctx.session.user.id, input.id);
    if (want.boughtOfferId === input.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This Offer was bought; cancel the order to delete it" });
    }
    assertOpen(want);
    const [deleted] = await db.delete(tcgOffer).where(eq(tcgOffer.id, input.id)).returning({ id: tcgOffer.id });
    if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Offer not found" });
    return deleted;
  }),
});
