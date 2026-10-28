/**
 * Copy Value, Collection Value and Gain (KOI-374). Pure: the DB side is `copy-value-db.ts`.
 */
import { tcgConditionEnum } from "@life-tracker/db/schema/index";

import type { Condition } from "../tcg-condition";
import { currentMarketPrice } from "./market-price";

/** The Marketplace a Printing's language is priced on: English on TCGplayer, the rest on CardTrader. */
export const copyMarketplace = (language: string) => (language === "en" ? "tcgplayer" : "cardtrader");

export type CopyValue = { usd: number; pricedAt: Condition; day: string; asOf: boolean };

/**
 * A Copy's Value on each of `days` (ascending): the lowest Current Market Price for its Printing on
 * its Marketplace at its Condition or better, times `usdPerUnit[i]` (that day's rate; null when
 * there is none). `pricedAt` is the Condition the price came from; on a tie, the Copy's own. Null
 * when unpriced. `prices` are one Printing's on one Marketplace, ascending by day.
 */
export function copyValues(
  condition: Condition,
  prices: Array<{ condition: Condition; day: string; price: number }>,
  days: string[],
  usdPerUnit: Array<number | null>,
): Array<CopyValue | null> {
  // Worst first, so the Copy's own Condition wins a tie.
  const conditions = tcgConditionEnum.enumValues.slice(0, tcgConditionEnum.enumValues.indexOf(condition) + 1).toReversed();
  const lines = conditions.map((c) => prices.filter((p) => p.condition === c));
  const cursors = lines.map(() => -1);
  return days.map((day, i) => {
    let best: (CopyValue & { price: number }) | null = null;
    lines.forEach((line, c) => {
      while (cursors[c]! + 1 < line.length && line[cursors[c]! + 1]!.day <= day) cursors[c]!++;
      const current = currentMarketPrice(line[cursors[c]!] ?? null, day);
      if (current && (!best || current.price < best.price)) {
        best = { usd: 0, price: current.price, pricedAt: conditions[c]!, day: current.day, asOf: current.asOf };
      }
    });
    const rate = usdPerUnit[i];
    if (!best || rate == null) return null;
    const { price, pricedAt, day: priceDay, asOf } = best;
    return { usd: price * rate, pricedAt, day: priceDay, asOf };
  });
}

/** Gain summed over Copies with both a value and a price paid, in USD and percent of what they cost. */
export function totalGain(copies: Array<{ usd: number | null; pricePaid: number | null }>) {
  const counted = copies.filter((c) => c.usd !== null && c.pricePaid !== null);
  if (counted.length === 0) return null;
  const paid = counted.reduce((sum, c) => sum + c.pricePaid!, 0);
  const usd = counted.reduce((sum, c) => sum + c.usd!, 0) - paid;
  return { usd, percent: paid > 0 ? (usd / paid) * 100 : null, copies: counted.length };
}
