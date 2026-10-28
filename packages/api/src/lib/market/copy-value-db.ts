import { exchangeRate, tcgMarketPrice } from "@life-tracker/db/schema/index";
import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";

import type { Condition } from "../tcg-condition";
import { copyMarketplace, copyValues } from "./copy-value";
import type { MarketDb } from "./exchange-rate-db";
import { CURRENT_PRICE_MAX_AGE_DAYS, daysBefore } from "./market-price";

type Copy = { printingId: string; language: string; condition: Condition };

const DAY_MS = 86_400_000;

/**
 * Each Copy's Value on every day from `start` (null: the first day any of their Printings has a
 * Market Price) to `today`, at each day's ECB rate: `values[copy][day]`. Two queries, whatever the
 * number of Copies or days.
 */
// ponytail: every Condition's rows over the range plus 30 days are loaded and walked in JS; filter
// Conditions in SQL or aggregate per day there if a large collection over All gets slow.
export async function copyValueHistory(db: MarketDb, copies: Copy[], start: string | null, today: string) {
  const byMarketplace = (marketplace: string) => [
    ...new Set(copies.filter((c) => copyMarketplace(c.language) === marketplace).map((c) => c.printingId)),
  ];
  const [tcgplayer, cardtrader] = [byMarketplace("tcgplayer"), byMarketplace("cardtrader")];
  const prices =
    copies.length === 0
      ? []
      : await db
          .select({
            printingId: tcgMarketPrice.printingId,
            condition: tcgMarketPrice.condition,
            day: tcgMarketPrice.day,
            price: tcgMarketPrice.price,
          })
          .from(tcgMarketPrice)
          .where(
            and(
              or(
                tcgplayer.length ? and(eq(tcgMarketPrice.marketplace, "tcgplayer"), inArray(tcgMarketPrice.printingId, tcgplayer)) : undefined,
                cardtrader.length ? and(eq(tcgMarketPrice.marketplace, "cardtrader"), inArray(tcgMarketPrice.printingId, cardtrader)) : undefined,
              ),
              lte(tcgMarketPrice.day, today),
              start === null ? undefined : gte(tcgMarketPrice.day, daysBefore(start, CURRENT_PRICE_MAX_AGE_DAYS)),
            ),
          )
          .orderBy(tcgMarketPrice.day);

  const first = start ?? prices[0]?.day ?? today;
  const days = Array.from({ length: (Date.parse(today) - Date.parse(first)) / DAY_MS + 1 }, (_, i) =>
    new Date(Date.parse(first) + i * DAY_MS).toISOString().slice(0, 10),
  );

  // USD per EUR from the latest publish on or before the first day, walked forward day by day.
  const rates =
    cardtrader.length === 0
      ? []
      : await db
          .select({ day: exchangeRate.day, perEur: exchangeRate.perEur })
          .from(exchangeRate)
          .where(
            and(
              eq(exchangeRate.currency, "USD"),
              lte(exchangeRate.day, today),
              gte(
                exchangeRate.day,
                sql`coalesce((select max(${exchangeRate.day}) from ${exchangeRate} where ${exchangeRate.currency} = 'USD' and ${exchangeRate.day} <= ${first}), ${first})`,
              ),
            ),
          )
          .orderBy(exchangeRate.day);
  let r = -1;
  const usdPerEur = days.map((day) => {
    while (r + 1 < rates.length && rates[r + 1]!.day <= day) r++;
    return rates[r]?.perEur ?? null;
  });

  const byPrinting = Map.groupBy(prices, (p) => p.printingId);
  const values = copies.map((c) =>
    copyValues(
      c.condition,
      byPrinting.get(c.printingId) ?? [],
      days,
      copyMarketplace(c.language) === "tcgplayer" ? days.map(() => 1) : usdPerEur,
    ),
  );
  return { days, values };
}
