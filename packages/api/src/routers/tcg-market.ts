import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { tcgMarketPrice, tcgPrinting } from "@life-tracker/db/schema/index";
import { TCG_ARTWORKS_MAX_LIMIT, todayInTimeZone } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import {
  CURRENT_PRICE_MAX_AGE_DAYS,
  MARKETPLACE_CURRENCY,
  currentMarketPrice,
  daysBefore,
  priceMove,
  shapeSeries,
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
});
