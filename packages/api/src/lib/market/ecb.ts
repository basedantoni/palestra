/**
 * ECB euro reference rates (KOI-364, ADR 0008): parsers for the daily XML and the history CSV, and
 * the USD cross rate every Market Price conversion uses. Pure: no HTTP, no DB.
 *
 * A rate is units of the currency per 1 EUR, as the ECB publishes it.
 */
import { strFromU8, unzipSync } from "fflate";

export const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export const ECB_HISTORY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip";

/** Units per EUR, by ISO currency code. */
export type PerEur = Map<string, number>;

/** One publish day's rates from `eurofxref-daily.xml`. */
export function parseEcbDaily(xml: string): { day: string; rates: PerEur } {
  const day = /<Cube\s+time=["'](\d{4}-\d{2}-\d{2})["']/.exec(xml)?.[1];
  const rates: PerEur = new Map();
  for (const [, currency, rate] of xml.matchAll(/<Cube\s+currency=["']([A-Z]{3})["']\s+rate=["']([\d.]+)["']/g)) {
    rates.set(currency!, Number(rate));
  }
  if (!day || rates.size === 0) throw new Error("ECB daily response has no reference rates");
  return { day, rates };
}

/**
 * `amount` of `currency` in USD, crossed through EUR: amount / (currency per EUR) × (USD per EUR).
 * Null without a rate for either side. Callers pass the latest rates on or before the price's day
 * (`ratesOn`), so a weekend or holiday uses the prior publish day.
 */
export function toUsd(amount: number, currency: string, rates: PerEur): number | null {
  if (currency === "USD") return amount;
  const perEur = currency === "EUR" ? 1 : rates.get(currency);
  const usdPerEur = rates.get("USD");
  if (perEur === undefined || usdPerEur === undefined) return null;
  return (amount / perEur) * usdPerEur;
}

export type RateRow ={ day: string; currency: string; perEur: number };

/**
 * Every publish day since 1999 from `eurofxref-hist.zip`: one CSV with a column per currency ever
 * published, `N/A` where a currency had no rate that day (before it started, after it ended).
 */
export function parseEcbHistory(zip: Uint8Array): RateRow[] {
  const csv = Object.values(unzipSync(zip, { filter: (f) => f.name.endsWith(".csv") }))[0];
  if (!csv) throw new Error("ECB history zip has no CSV");
  const [header = "", ...lines] = strFromU8(csv).trim().split(/\r?\n/);
  const currencies = header.split(",").slice(1);
  const rows: RateRow[] = [];
  for (const line of lines) {
    const [day, ...cells] = line.split(",");
    cells.forEach((cell, i) => {
      const perEur = Number(cell);
      if (currencies[i] && cell !== "N/A" && cell !== "" && Number.isFinite(perEur)) {
        rows.push({ day: day!, currency: currencies[i]!, perEur });
      }
    });
  }
  return rows;
}
