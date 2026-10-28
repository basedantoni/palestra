import { and, eq, gte, inArray, isNotNull, lte, min, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import {
  exchangeRate,
  tcgConditionEnum,
  tcgCopy,
  tcgMarketPrice,
  tcgMarketplaceEnum,
  tcgOffer,
  tcgPrinting,
  tcgWant,
} from "@life-tracker/db/schema/index";
import { TCG_ARTWORKS_MAX_LIMIT, todayInTimeZone } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import { toUsd } from "../lib/market/ecb";
import { ratesOn } from "../lib/market/exchange-rate-db";
import {
  CURRENT_PRICE_MAX_AGE_DAYS,
  MARKETPLACE_CURRENCY,
  PRICE_RANGES,
  currentMarketPrice,
  daysBefore,
  priceMove,
  rangeAvailability,
  rangeStart,
  shapeSeries,
  type PriceRange,
} from "../lib/market/market-price";

/** Market Watch reads (KOI-366). Market Prices are global; "today" is the UTC day, as capture days are. */
export const tcgMarketRouter = router({
  /**
   * The Current Market Price of each shown Artwork's English Printing (TCGplayer, NM, USD), with its
   * 7d Price Move and 30-day sparkline (KOI-367). A Printing with no Current Market Price is absent.
   */
  // ponytail: ~31 rows per Printing, ~165k for the whole catalog; aggregate in SQL if that bites.
  tilePrices: protectedProcedure
    .input(z.object({ variantIds: z.array(z.string().max(40)).max(TCG_ARTWORKS_MAX_LIMIT) }))
    .query(async ({ input }) => {
      if (input.variantIds.length === 0) return [];
      const today = todayInTimeZone(new Date(), "UTC");
      // The last 30 days cover the Current Market Price, the sparkline and the 7d move's start price.
      const rows = await db
        .select({
          printingId: tcgMarketPrice.printingId,
          variantId: tcgPrinting.variantId,
          language: tcgPrinting.language,
          price: tcgMarketPrice.price,
          day: tcgMarketPrice.day,
        })
        .from(tcgMarketPrice)
        .innerJoin(tcgPrinting, eq(tcgPrinting.id, tcgMarketPrice.printingId))
        .where(
          and(
            inArray(tcgPrinting.variantId, input.variantIds),
            eq(tcgPrinting.language, "en"),
            eq(tcgMarketPrice.marketplace, "tcgplayer"),
            eq(tcgMarketPrice.condition, "NM"),
            lte(tcgMarketPrice.day, today),
            gte(tcgMarketPrice.day, daysBefore(today, CURRENT_PRICE_MAX_AGE_DAYS)),
          ),
        )
        .orderBy(tcgMarketPrice.printingId, tcgMarketPrice.day);
      return [...Map.groupBy(rows, (r) => r.printingId).values()]
        .flatMap((prices) => {
          const { printingId, variantId, language, price, day } = prices.at(-1)!;
          const current = currentMarketPrice({ price, day }, today);
          if (!current) return [];
          const points = prices.map((r) => ({ day: r.day, price: r.price }));
          return [
            {
              printingId,
              variantId,
              language,
              currency: MARKETPLACE_CURRENCY.tcgplayer,
              ...current,
              move7d: priceMove(points, today, 7),
              sparkline: shapeSeries(points).segments,
            },
          ];
        })
        .toSorted((a, b) => a.variantId.localeCompare(b.variantId));
    }),

  /**
   * The Printing drawer (KOI-370): Price History per Marketplace × Condition over `range`, in USD
   * at each day's ECB rate so it compares with Offers and prices paid; the range tabs each Condition
   * reaches; a grid of Current Market Prices in native currency and USD at today's rate; and the
   * user's own Offers in the range and Copies' prices paid on this Printing.
   */
  printing: protectedProcedure
    .input(
      z.object({
        printingId: z.uuid(),
        range: z.enum(Object.keys(PRICE_RANGES) as [PriceRange, ...PriceRange[]]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const today = todayInTimeZone(new Date(), "UTC");
      const start = rangeStart(input.range, today);
      const where = and(eq(tcgMarketPrice.printingId, input.printingId), lte(tcgMarketPrice.day, today));
      const [firsts, rows, rates, offers, paid] = await Promise.all([
        // Each Marketplace × Condition's first real day, whatever the range: what the range tabs reach.
        db
          .select({ marketplace: tcgMarketPrice.marketplace, condition: tcgMarketPrice.condition, day: min(tcgMarketPrice.day) })
          .from(tcgMarketPrice)
          .where(where)
          .groupBy(tcgMarketPrice.marketplace, tcgMarketPrice.condition),
        db
          .select({
            marketplace: tcgMarketPrice.marketplace,
            condition: tcgMarketPrice.condition,
            day: tcgMarketPrice.day,
            price: tcgMarketPrice.price,
            listingCount: tcgMarketPrice.listingCount,
            // The latest USD rate on or before the day (only EUR needs one: the Marketplace currencies are
            // USD and EUR). The outer day is qualified by hand: drizzle would render it as a bare "day".
            usdPerEur: sql<number | null>`(select ${exchangeRate.perEur} from ${exchangeRate} where ${exchangeRate.currency} = 'USD' and ${exchangeRate.day} <= ${tcgMarketPrice}.${sql.identifier(tcgMarketPrice.day.name)} order by ${exchangeRate.day} desc limit 1)`,
          })
          .from(tcgMarketPrice)
          .where(and(where, start === null ? undefined : gte(tcgMarketPrice.day, start)))
          .orderBy(tcgMarketPrice.marketplace, tcgMarketPrice.condition, tcgMarketPrice.day),
        ratesOn(db, today),
        db
          .select({ seenOn: tcgOffer.seenOn, price: tcgOffer.price })
          .from(tcgOffer)
          .innerJoin(tcgWant, eq(tcgWant.id, tcgOffer.wantId))
          .where(
            and(
              eq(tcgWant.userId, userId),
              eq(tcgOffer.printingId, input.printingId),
              start === null ? undefined : gte(tcgOffer.seenOn, start),
            ),
          )
          .orderBy(tcgOffer.seenOn),
        db
          .select({ pricePaid: tcgCopy.pricePaid })
          .from(tcgCopy)
          .where(and(eq(tcgCopy.userId, userId), eq(tcgCopy.printingId, input.printingId), isNotNull(tcgCopy.pricePaid)))
          .orderBy(tcgCopy.acquiredOn),
      ]);

      const byLine = Map.groupBy(rows, (r) => `${r.marketplace}:${r.condition}`);
      const series = [...byLine.values()].map((prices) => {
        const { marketplace, condition } = prices[0]!;
        const currency = MARKETPLACE_CURRENCY[marketplace];
        // A day with no rate yet can't be drawn in USD, so it is left out rather than guessed.
        const points = prices.flatMap(({ day, price, usdPerEur }) => {
          const usd = toUsd(price, currency, new Map(usdPerEur === null ? [] : [["USD", usdPerEur]]));
          return usd === null ? [] : [{ day, price, usd }];
        });
        return { marketplace, condition, currency, segments: shapeSeries(points).segments };
      });
      const ranges = Object.fromEntries(
        tcgConditionEnum.enumValues.map((condition) => [
          condition,
          rangeAvailability(firsts.flatMap((f) => (f.condition === condition && f.day ? [f.day] : [])), today),
        ]),
      ) as Record<(typeof tcgConditionEnum.enumValues)[number], Record<PriceRange, boolean>>;

      // Every range starts at least 30 days back, so the rows hold each line's Current Market Price.
      const grid = tcgMarketplaceEnum.enumValues
        .filter((marketplace) => firsts.some((f) => f.marketplace === marketplace))
        .flatMap((marketplace) =>
          tcgConditionEnum.enumValues.map((condition) => {
            const currency = MARKETPLACE_CURRENCY[marketplace];
            const latest = byLine.get(`${marketplace}:${condition}`)?.at(-1);
            const current = latest && currentMarketPrice(latest, today);
            return {
              marketplace,
              condition,
              currency,
              current: current
                ? {
                    price: current.price,
                    usd: toUsd(current.price, currency, rates),
                    day: current.day,
                    asOf: current.asOf,
                    listingCount: current.listingCount,
                  }
                : null,
            };
          }),
        );

      return { today, series, ranges, grid, offers, pricesPaid: paid.map((c) => c.pricePaid!) };
    }),
});
