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

/** A Price Move's start price is at most this many days older than its window start. */
const MOVE_START_MAX_AGE_DAYS = 7;

/**
 * The Price Move over the `days` ending `today`, in percent, from one Printing's Market Prices on
 * one Marketplace (ascending by day, native currency, so exchange rates never count). The end price
 * is the latest inside the window (after its start); the start price is the latest on or before the
 * window start, at most 7 days older. Missing either, there is no move.
 */
export function priceMove(prices: Array<{ day: string; price: number }>, today: string, days: number) {
  const windowStart = daysBefore(today, days);
  const end = prices.findLast((p) => p.day > windowStart && p.day <= today);
  const start = prices.findLast((p) => p.day <= windowStart);
  if (!end || !start || start.day < daysBefore(windowStart, MOVE_START_MAX_AGE_DAYS) || start.price <= 0) return null;
  return (end.price / start.price - 1) * 100;
}

/** A Price History line joins real points at most this many days apart and breaks longer gaps. */
const SERIES_MAX_GAP_DAYS = 7;

/**
 * Shapes Market Prices (ascending by day) for a sparkline or chart: real points only, nothing
 * carried forward, split into line segments at gaps over 7 days. `earliest` is the first real day.
 */
export function shapeSeries<T extends { day: string }>(points: T[]) {
  const segments: T[][] = [];
  for (const [i, point] of points.entries()) {
    const prev = points[i - 1];
    if (prev && Date.parse(point.day) - Date.parse(prev.day) <= SERIES_MAX_GAP_DAYS * DAY_MS) segments.at(-1)!.push(point);
    else segments.push([point]);
  }
  return { segments, earliest: points[0]?.day ?? null };
}

/** The Price History range tabs and the days each spans back from today; All has no start. */
export const PRICE_RANGES = { "1M": 30, "3M": 90, "1Y": 365, All: null } as const;
export type PriceRange = keyof typeof PRICE_RANGES;

/** The first day a range shows, or null for All. */
export const rangeStart = (range: PriceRange, today: string) => {
  const days = PRICE_RANGES[range];
  return days === null ? null : daysBefore(today, days);
};

/**
 * Which range tabs a chart offers, from each shown Marketplace's earliest real day: a range is
 * available when one of them reaches its start, so no range is ever faked. 1M, the default, always
 * is; All, which has no start, is once history goes back past 1M, so no real day is out of reach.
 */
export function rangeAvailability(earliest: string[], today: string): Record<PriceRange, boolean> {
  const oldest = earliest.toSorted()[0];
  const reaches = (range: PriceRange) => oldest !== undefined && oldest <= rangeStart(range, today)!;
  return { "1M": true, "3M": reaches("3M"), "1Y": reaches("1Y"), All: oldest !== undefined && oldest < rangeStart("1M", today)! };
}
