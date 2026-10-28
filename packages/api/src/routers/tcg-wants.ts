import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import {
  tcgArtwork,
  tcgCard,
  tcgConditionEnum,
  tcgCopy,
  tcgLanguageEnum,
  tcgMarketPrice,
  tcgOffer,
  tcgPrinting,
  tcgWant,
  tcgWantStatusEnum,
} from "@life-tracker/db/schema/index";
import { TCG_LANGUAGE_NAME, todayInTimeZone } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import { toUsd } from "../lib/market/ecb";
import { ratesOn } from "../lib/market/exchange-rate-db";
import { CURRENT_PRICE_MAX_AGE_DAYS, MARKETPLACE_CURRENCY, daysBefore } from "../lib/market/market-price";
import { offerVsMarket, wantMarketPrice } from "../lib/market/want-market";
import type { Conn } from "../lib/rules-db";
import { isBelowCondition } from "../lib/tcg-condition";

const terms = z.object({
  /** Accepted languages: one or more. */
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
  /**
   * The caller's Wants in one status (open by default), newest first, with their Artwork; each
   * accepted language's NM Current Market Price in USD with its 30-day range, and each Offer
   * against today's NM price for its Printing at today's rate (KOI-373).
   */
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
            imageUrl: tcgPrinting.imageUrl,
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

      const today = todayInTimeZone(new Date(), "UTC");
      const marketByPrinting = await marketPrices(
        printings.map((p) => p.id),
        today,
      );

      const offersByWant = Map.groupBy(offers, (o) => o.wantId);
      return wants.map((want) => {
        const wantOffers = (offersByWant.get(want.id) ?? [])
          .map(({ wantId: _wantId, ...o }) => ({
            ...o,
            /** ±% against today's market, muted once the Offer is over 7 days old. */
            vsMarket: offerVsMarket(o, marketByPrinting.get(o.printingId)?.price ?? null, today),
          }))
          .toSorted((a, b) => a.price - b.price);
        const cheapest = wantOffers[0] ?? null;
        const artworkPrintings = printings.filter((p) => p.variantId === want.variantId);
        const accepted = artworkPrintings.filter((p) => want.languages.includes(p.language));
        // Japanese first (enum order), like browse; an accepted language over any other.
        const pictured = accepted[0] ?? artworkPrintings[0] ?? null;
        return {
          ...want,
          imageUrl: pictured?.imageUrl ?? null,
          /** The pictured Printing, whose drawer the image opens. */
          pictured: pictured && { printingId: pictured.id, language: pictured.language },
          /** Each accepted language's NM Current Market Price; null where there is none. */
          market: want.languages.map((language) => {
            const printing = accepted.find((p) => p.language === language);
            return {
              language,
              printingId: printing?.id ?? null,
              current: (printing && marketByPrinting.get(printing.id)) ?? null,
            };
          }),
          /** Printings an Offer may name: this Artwork, accepted languages. */
          printings: accepted.map(({ variantId: _variantId, imageUrl: _imageUrl, ...p }) => p),
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

/**
 * Each Printing's NM Current Market Price in USD on `today` with its 30-day range: English from
 * TCGplayer, the other languages from CardTrader (as tile prices), at today's rate. An unpriced
 * Printing is absent.
 */
async function marketPrices(printingIds: string[], today: string) {
  if (printingIds.length === 0) return new Map<string, NonNullable<ReturnType<typeof wantMarketPrice>>>();
  const [rows, rates] = await Promise.all([
    db
      .select({
        printingId: tcgMarketPrice.printingId,
        marketplace: tcgMarketPrice.marketplace,
        day: tcgMarketPrice.day,
        price: tcgMarketPrice.price,
      })
      .from(tcgMarketPrice)
      .innerJoin(tcgPrinting, eq(tcgPrinting.id, tcgMarketPrice.printingId))
      .where(
        and(
          inArray(tcgMarketPrice.printingId, printingIds),
          or(
            and(eq(tcgPrinting.language, "en"), eq(tcgMarketPrice.marketplace, "tcgplayer")),
            and(ne(tcgPrinting.language, "en"), eq(tcgMarketPrice.marketplace, "cardtrader")),
          ),
          eq(tcgMarketPrice.condition, "NM"),
          lte(tcgMarketPrice.day, today),
          gte(tcgMarketPrice.day, daysBefore(today, CURRENT_PRICE_MAX_AGE_DAYS)),
        ),
      )
      .orderBy(tcgMarketPrice.printingId, tcgMarketPrice.day),
    ratesOn(db, today),
  ]);
  return new Map(
    [...Map.groupBy(rows, (r) => r.printingId)].flatMap(([printingId, prices]) => {
      const usdPerUnit = toUsd(1, MARKETPLACE_CURRENCY[prices[0]!.marketplace], rates);
      const market = wantMarketPrice(prices, today, usdPerUnit);
      return market ? [[printingId, market] as const] : [];
    }),
  );
}

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
