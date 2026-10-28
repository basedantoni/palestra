import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { tcgMarketPrice, tcgPrinting } from "@life-tracker/db/schema/index";
import { TCG_ARTWORKS_MAX_LIMIT, todayInTimeZone } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import { toUsd } from "../lib/market/ecb";
import { ratesOn } from "../lib/market/exchange-rate-db";
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
   * The NM Current Market Price of each shown Artwork's English (TCGplayer) and Japanese
   * (CardTrader) Printings in USD, with its 7d Price Move and 30-day sparkline (KOI-367, KOI-369).
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
              and(eq(tcgPrinting.language, "ja"), eq(tcgMarketPrice.marketplace, "cardtrader")),
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
});
