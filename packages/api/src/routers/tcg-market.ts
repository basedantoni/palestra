import { and, eq, gte, inArray, isNotNull, lte, min, ne, or, sql } from "drizzle-orm";
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
import { totalGain } from "../lib/market/copy-value";
import { copyValueHistory } from "../lib/market/copy-value-db";
import { toUsd } from "../lib/market/ecb";
import { ratesOn } from "../lib/market/exchange-rate-db";
import type { Condition } from "../lib/tcg-condition";
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
   * The NM Current Market Price of each shown Artwork's English (TCGplayer) and Japanese,
   * Simplified Chinese and Korean (CardTrader) Printings in USD, with its 7d Price Move and 30-day
   * sparkline (KOI-367, KOI-369, KOI-372).
   * A CardTrader price converts at today's rate; its Price Move stays in EUR. A Printing with no
   * Current Market Price, or none convertible today, is absent.
   */
  // ponytail: ~31 rows per Printing, ~330k for the whole catalog; aggregate in SQL if that bites.
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
          marketplace: tcgMarketPrice.marketplace,
          price: tcgMarketPrice.price,
          day: tcgMarketPrice.day,
        })
        .from(tcgMarketPrice)
        .innerJoin(tcgPrinting, eq(tcgPrinting.id, tcgMarketPrice.printingId))
        .where(
          and(
            inArray(tcgPrinting.variantId, input.variantIds),
            or(
              and(eq(tcgPrinting.language, "en"), eq(tcgMarketPrice.marketplace, "tcgplayer")),
              and(ne(tcgPrinting.language, "en"), eq(tcgMarketPrice.marketplace, "cardtrader")),
            ),
            eq(tcgMarketPrice.condition, "NM"),
            lte(tcgMarketPrice.day, today),
            gte(tcgMarketPrice.day, daysBefore(today, CURRENT_PRICE_MAX_AGE_DAYS)),
          ),
        )
        .orderBy(tcgMarketPrice.printingId, tcgMarketPrice.day);
      const rates = await ratesOn(db, today);
      return [...Map.groupBy(rows, (r) => r.printingId).values()]
        .flatMap((prices) => {
          const { printingId, variantId, language, marketplace, price, day } = prices.at(-1)!;
          const current = currentMarketPrice({ price, day }, today);
          const usdPerUnit = toUsd(1, MARKETPLACE_CURRENCY[marketplace], rates);
          if (!current || usdPerUnit === null) return [];
          const points = prices.map((r) => ({ day: r.day, price: r.price }));
          return [
            {
              printingId,
              variantId,
              language,
              currency: "USD" as const,
              ...current,
              price: current.price * usdPerUnit,
              move7d: priceMove(points, today, 7),
              // One rate for every point, so the line keeps the native price's shape.
              sparkline: shapeSeries(points.map((p) => ({ ...p, price: p.price * usdPerUnit }))).segments,
            },
          ];
        })
        .toSorted((a, b) => a.variantId.localeCompare(b.variantId) || a.language.localeCompare(b.language));
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
      const [earliest, rows, rates, offers, paid] = await Promise.all([
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
          rangeAvailability(earliest.flatMap((f) => (f.condition === condition && f.day ? [f.day] : [])), today),
        ]),
      ) as Record<Condition, Record<PriceRange, boolean>>;

      // Every range starts at least 30 days back, so the rows hold each line's Current Market Price.
      const grid = tcgMarketplaceEnum.enumValues
        .filter((marketplace) => earliest.some((f) => f.marketplace === marketplace))
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

  /**
   * Collection Value (KOI-374): today's value over the Copies the user holds today with how many are
   * priced, the total Gain, and its history over `range`, which revalues today's Copies at each past
   * day's prices and rates, so buying a card is never a change and an exchange-rate swing is. A day
   * with no Copy priced has no point. Shared by My Copies, the Binder and the pulse strip.
   */
  collectionHistory: protectedProcedure
    .input(z.object({ range: z.enum(Object.keys(PRICE_RANGES) as [PriceRange, ...PriceRange[]]) }))
    .query(async ({ ctx, input }) => {
      const today = todayInTimeZone(new Date(), "UTC");
      const copies = await db
        .select({
          printingId: tcgCopy.printingId,
          language: tcgPrinting.language,
          condition: tcgCopy.condition,
          pricePaid: tcgCopy.pricePaid,
        })
        .from(tcgCopy)
        .innerJoin(tcgPrinting, eq(tcgPrinting.id, tcgCopy.printingId))
        .where(eq(tcgCopy.userId, ctx.session.user.id));
      const { days, values } = await copyValueHistory(db, copies, rangeStart(input.range, today), today);
      const points = days.flatMap((day, d) => {
        const priced = values.flatMap((v) => (v[d] ? [v[d].usd] : []));
        return priced.length ? [{ day, usd: priced.reduce((a, b) => a + b, 0), priced: priced.length }] : [];
      });
      const last = points.at(-1);
      return {
        today,
        copies: copies.length,
        value: last?.day === today ? last : null,
        gain: totalGain(copies.map((c, i) => ({ usd: values[i]!.at(-1)?.usd ?? null, pricePaid: c.pricePaid }))),
        points,
      };
    }),
});
