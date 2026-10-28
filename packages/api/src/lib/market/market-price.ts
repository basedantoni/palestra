/**
 * Read-side Market Price rules (KOI-366), shared by every surface that shows a price. Pure.
 */

/** Each Marketplace's one currency: Market Prices are stored in it, never converted on write. */
export const MARKETPLACE_CURRENCY = { tcgplayer: "USD", cardtrader: "EUR" } as const;

/** A Current Market Price is at most this many days old... */
export const CURRENT_PRICE_MAX_AGE_DAYS = 30;
/** ...and shows its date once older than this. */
const AS_OF_AFTER_DAYS = 7;

const DAY_MS = 86_400_000;

/** `day` (YYYY-MM-DD) minus `days`. */
export const daysBefore = (day: string, days: number) =>
  new Date(Date.parse(day) - days * DAY_MS).toISOString().slice(0, 10);

/**
 * The Current Market Price on `today` from the latest Market Price on or before it: none when that
 * is more than 30 days old, flagged "as of" when more than 7. Nothing is carried forward.
 */
export function currentMarketPrice<T extends { day: string }>(latest: T | null, today: string) {
  if (!latest || latest.day > today) return null;
  const age = (Date.parse(today) - Date.parse(latest.day)) / DAY_MS;
  if (age > CURRENT_PRICE_MAX_AGE_DAYS) return null;
  return { ...latest, asOf: age > AS_OF_AFTER_DAYS };
}
