import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
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
} from "../lib/market/market-price";

/** Market Watch reads (KOI-366). Market Prices are global; "today" is the UTC day, as capture days are. */
export const tcgMarketRouter = router({
  /**
   * The Current Market Price of each shown Artwork's English Printing: TCGplayer, NM, USD. A
   * Printing with none is absent.
   */
  tilePrices: protectedProcedure
    .input(z.object({ variantIds: z.array(z.string().max(40)).max(TCG_ARTWORKS_MAX_LIMIT) }))
    .query(async ({ input }) => {
      if (input.variantIds.length === 0) return [];
      const today = todayInTimeZone(new Date(), "UTC");
      const latest = await db
        .selectDistinctOn([tcgMarketPrice.printingId], {
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
        .orderBy(tcgMarketPrice.printingId, desc(tcgMarketPrice.day));
      return latest
        .flatMap(({ printingId, variantId, language, price, day }) => {
          const current = currentMarketPrice({ price, day }, today);
          return current
            ? [{ printingId, variantId, language, currency: MARKETPLACE_CURRENCY.tcgplayer, ...current }]
            : [];
        })
        .toSorted((a, b) => a.variantId.localeCompare(b.variantId));
    }),
});
