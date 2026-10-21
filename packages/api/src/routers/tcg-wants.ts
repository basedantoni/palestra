import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import {
  tcgArtwork,
  tcgCard,
  tcgConditionEnum,
  tcgCopy,
  tcgLanguageEnum,
  tcgOffer,
  tcgPrinting,
  tcgWant,
  tcgWantStatusEnum,
} from "@life-tracker/db/schema/index";
import { TCG_LANGUAGE_NAME } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import type { Conn } from "../lib/rules-db";
import { isBelowCondition } from "../lib/tcg-condition";

const terms = z.object({
  /** Accepted languages: Japanese, English, or both. */
  languages: z
    .array(z.enum(tcgLanguageEnum.enumValues))
    .min(1, "Pick at least one language")
    .transform((langs) => [...new Set(langs)]),
  /** Maximum delivered price, USD. */
  maxPrice: z.number().positive().finite(),
  minCondition: z.enum(tcgConditionEnum.enumValues),
});

/** Wants (KOI-308): the Artworks the user is after. */
export const tcgWantsRouter = router({
  /** The caller's Wants in one status (open by default), newest first, with their Artwork. */
  list: protectedProcedure
    .input(z.object({ status: z.enum(tcgWantStatusEnum.enumValues).default("open") }).default({ status: "open" }))
    .query(async ({ ctx, input }) => {
      const wants = await db
        .select({
          id: tcgWant.id,
          variantId: tcgWant.variantId,
          languages: tcgWant.languages,
          maxPrice: tcgWant.maxPrice,
          minCondition: tcgWant.minCondition,
          status: tcgWant.status,
          boughtOfferId: tcgWant.boughtOfferId,
          createdAt: tcgWant.createdAt,
          /** The Condition of the Copy this Want was fulfilled by. */
          receivedCondition: sql<
            (typeof tcgConditionEnum.enumValues)[number] | null
          >`(select ${tcgCopy.condition} from ${tcgCopy} where ${tcgCopy.wantId} = ${tcgWant.id} limit 1)`,
          cardNumber: tcgArtwork.cardNumber,
          variantKind: tcgArtwork.variantKind,
          nameEn: tcgCard.nameEn,
          nameJa: tcgCard.nameJa,
          // Japanese first (enum order), like browse.
          imageUrl: sql<string | null>`(select ${tcgPrinting.imageUrl} from ${tcgPrinting} where ${tcgPrinting.variantId} = ${tcgWant.variantId} order by ${tcgPrinting.language} limit 1)`,
        })
        .from(tcgWant)
        .innerJoin(tcgArtwork, eq(tcgArtwork.variantId, tcgWant.variantId))
        .innerJoin(tcgCard, eq(tcgCard.number, tcgArtwork.cardNumber))
        .where(and(eq(tcgWant.userId, ctx.session.user.id), eq(tcgWant.status, input.status)))
        .orderBy(desc(tcgWant.createdAt));
      if (wants.length === 0) return [];

      // The Offers of these (the caller's) Wants, and their Artworks' Printings for adding more.
      const [printings, offers] = await Promise.all([
        db
          .select({
            id: tcgPrinting.id,
            variantId: tcgPrinting.variantId,
            language: tcgPrinting.language,
            setName: tcgPrinting.setName,
          })
          .from(tcgPrinting)
          .where(inArray(tcgPrinting.variantId, [...new Set(wants.map((w) => w.variantId))]))
          .orderBy(asc(tcgPrinting.language)),
        db
          .select({
            id: tcgOffer.id,
            wantId: tcgOffer.wantId,
            printingId: tcgOffer.printingId,
            language: tcgPrinting.language,
            setName: tcgPrinting.setName,
            seller: tcgOffer.seller,
            price: tcgOffer.price,
            url: tcgOffer.url,
            seenOn: tcgOffer.seenOn,
          })
          .from(tcgOffer)
          .innerJoin(tcgPrinting, eq(tcgPrinting.id, tcgOffer.printingId))
          .where(
            inArray(
              tcgOffer.wantId,
              wants.map((w) => w.id),
            ),
          )
          .orderBy(desc(tcgOffer.seenOn)),
      ]);

      const offersByWant = Map.groupBy(offers, (o) => o.wantId);
      return wants.map((want) => {
        const wantOffers = (offersByWant.get(want.id) ?? [])
          .map(({ wantId: _wantId, ...o }) => o)
          .toSorted((a, b) => a.price - b.price);
        const cheapest = wantOffers[0] ?? null;
        return {
          ...want,
          /** Printings an Offer may name: this Artwork, accepted languages. */
          printings: printings
            .filter((p) => p.variantId === want.variantId && want.languages.includes(p.language))
            .map(({ variantId: _variantId, ...p }) => p),
          /** Cheapest first; Japanese and English compete when both are accepted. */
          offers: wantOffers,
          cheapest,
          /** An Offer at or under the maximum delivered price. */
          buyable: cheapest !== null && cheapest.price <= want.maxPrice,
          /** Received in a Condition worse than the minimum (allowed: the card is in hand). */
          belowMinimum: !!want.receivedCondition && isBelowCondition(want.receivedCondition, want.minCondition),
        };
      });
    }),

  create: protectedProcedure
    .input(terms.extend({ variantId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [artwork] = await db
        .select({ variantId: tcgArtwork.variantId })
        .from(tcgArtwork)
        .where(eq(tcgArtwork.variantId, input.variantId))
        .limit(1);
      if (!artwork) throw new TRPCError({ code: "NOT_FOUND", message: "Artwork not found" });

      const [created] = await db
        .insert(tcgWant)
        .values({
          userId: ctx.session.user.id,
          variantId: input.variantId,
          languages: input.languages,
          maxPrice: input.maxPrice,
          minCondition: input.minCondition,
          status: "open",
        })
        .returning({ id: tcgWant.id });
      return created!;
    }),

  /** Edit a Want's terms. */
  update: protectedProcedure.input(terms.extend({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const { id, ...set } = input;
    // An Offer in a dropped language would still count as cheapest/buyable but no longer be editable.
    const [stranded] = await db
      .select({ language: tcgPrinting.language })
      .from(tcgOffer)
      .innerJoin(tcgPrinting, eq(tcgPrinting.id, tcgOffer.printingId))
      .innerJoin(tcgWant, eq(tcgWant.id, tcgOffer.wantId))
      .where(
        and(
          eq(tcgOffer.wantId, id),
          eq(tcgWant.userId, ctx.session.user.id),
          notInArray(tcgPrinting.language, set.languages),
        ),
      )
      .limit(1);
    if (stranded) {
      const name = TCG_LANGUAGE_NAME[stranded.language];
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `This Want has ${name} Offers; delete them before dropping ${name}`,
      });
    }
    const [updated] = await db
      .update(tcgWant)
      .set(set)
      .where(and(eq(tcgWant.id, id), eq(tcgWant.userId, ctx.session.user.id)))
      .returning({ id: tcgWant.id });
    if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Want not found" });
    return updated;
  }),

  /** open → dropped: abandon a Want without deleting it. */
  drop: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => transition(db, ctx.session.user.id, input.id, "open", "dropped")),

  /** dropped → open. */
  reopen: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => transition(db, ctx.session.user.id, input.id, "dropped", "open")),

  /** open → ordered: one of this Want's Offers was bought. */
  buy: protectedProcedure
    .input(z.object({ id: z.string().uuid(), offerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const [offer] = await db
        .select({ id: tcgOffer.id })
        .from(tcgOffer)
        .innerJoin(tcgWant, eq(tcgWant.id, tcgOffer.wantId))
        .where(and(eq(tcgOffer.id, input.offerId), eq(tcgOffer.wantId, input.id), eq(tcgWant.userId, userId)))
        .limit(1);
      if (!offer) throw new TRPCError({ code: "NOT_FOUND", message: "Offer not found for this Want" });
      return transition(db, userId, input.id, "open", "ordered", { boughtOfferId: offer.id });
    }),

  /** ordered → open: the order was cancelled or failed. */
  cancelOrder: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      transition(db, ctx.session.user.id, input.id, "ordered", "open", { boughtOfferId: null }),
    ),

  /**
   * ordered → fulfilled: the card arrived. Creates exactly one Copy of the bought
   * Offer's Printing, in the same transaction. Price paid defaults to the Offer's.
   * A Condition below the Want's minimum is accepted (the card is in hand).
   */
  receive: protectedProcedure
    .input(
      z.object({
        id: z.uuid(),
        condition: z.enum(tcgConditionEnum.enumValues),
        pricePaid: z.number().nonnegative().nullish(),
        acquiredOn: z.iso.date(),
      }),
    )
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        const userId = ctx.session.user.id;
        const want = await transition(tx, userId, input.id, "ordered", "fulfilled");
        const [offer] = await tx
          .select({ printingId: tcgOffer.printingId, price: tcgOffer.price })
          .from(tcgOffer)
          .where(eq(tcgOffer.id, want.boughtOfferId!))
          .limit(1);
        const [copy] = await tx
          .insert(tcgCopy)
          .values({
            userId,
            printingId: offer!.printingId,
            condition: input.condition,
            pricePaid: input.pricePaid === undefined ? offer!.price : input.pricePaid,
            acquiredOn: input.acquiredOn,
            wantId: want.id,
          })
          .returning({ id: tcgCopy.id });
        return { id: want.id, copyId: copy!.id };
      }),
    ),
});

type WantStatus = (typeof tcgWantStatusEnum.enumValues)[number];

/**
 * Move the caller's Want from `from` to `to` (plus `set`); any other current
 * status is rejected. Returns the Want's id and bought Offer after the move.
 */
async function transition(
  conn: Conn,
  userId: string,
  id: string,
  from: WantStatus,
  to: WantStatus,
  set: { boughtOfferId?: string | null } = {},
) {
  const owned = and(eq(tcgWant.id, id), eq(tcgWant.userId, userId));
  const [want] = await conn.select({ status: tcgWant.status }).from(tcgWant).where(owned).limit(1);
  if (!want) throw new TRPCError({ code: "NOT_FOUND", message: "Want not found" });
  if (want.status !== from) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `A ${want.status} Want can't become ${to}` });
  }
  // The status guard keeps a concurrent change from being overwritten.
  const [updated] = await conn
    .update(tcgWant)
    .set({ status: to, ...set })
    .where(and(owned, eq(tcgWant.status, from)))
    .returning({ id: tcgWant.id, boughtOfferId: tcgWant.boughtOfferId });
  if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Want changed; reload and try again" });
  return updated;
}
