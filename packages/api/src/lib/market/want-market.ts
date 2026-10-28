/**
 * Market Prices beside Wants and Offers (KOI-373). Pure.
 */
import { CURRENT_PRICE_MAX_AGE_DAYS, currentMarketPrice, daysBefore } from "./market-price";

/** An Offer is compared with today's market; once older than this, the comparison is muted. */
const OFFER_FRESH_DAYS = 7;

/**
 * A Printing's NM Current Market Price in USD on `today`, with its 30-day low and high, from its
 * Market Prices on its Marketplace (ascending by day, native currency) and today's USD per unit of
 * that currency. One rate for every price, like the tile sparkline. Null with no Current Market
 * Price or no rate.
 */
export function wantMarketPrice(prices: Array<{ day: string; price: number }>, today: string, usdPerUnit: number | null) {
  const start = daysBefore(today, CURRENT_PRICE_MAX_AGE_DAYS);
  const window = prices.filter((p) => p.day >= start && p.day <= today);
  const current = currentMarketPrice(window.at(-1) ?? null, today);
  if (!current || usdPerUnit === null) return null;
  const usd = window.map((p) => p.price * usdPerUnit);
  return { price: current.price * usdPerUnit, day: current.day, asOf: current.asOf, low: Math.min(...usd), high: Math.max(...usd) };
}

/**
 * An Offer's delivered price against today's Current Market Price (USD) for its Printing, in
 * percent; `stale` once the Offer is more than 7 days old. Null with no Current Market Price.
 */
export function offerVsMarket(offer: { price: number; seenOn: string }, marketUsd: number | null, today: string) {
  if (marketUsd === null || marketUsd <= 0) return null;
  return { percent: (offer.price / marketUsd - 1) * 100, stale: offer.seenOn < daysBefore(today, OFFER_FRESH_DAYS) };
}
