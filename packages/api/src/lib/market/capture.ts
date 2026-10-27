/**
 * Market Watch capture jobs (KOI-364, ADR 0008): fetch a source, land the raw response gzipped at
 * `raw/<source>/<day>/`, then derive rows from the landed copy, never from the live response. A
 * replay (`market.derive`) runs the same derive step on a day already landed.
 *
 * `<day>` is the capture's UTC day. The rows' day comes from the data: a Saturday capture of
 * `eurofxref-daily.xml` holds Friday's rates and replaces Friday.
 */
import { gunzipSync, gzipSync } from "node:zlib";

import { ECB_DAILY_URL, ECB_HISTORY_URL, parseEcbDaily, parseEcbHistory } from "./ecb";
import { type MarketDb, replaceRates } from "./exchange-rate-db";
import type { ObjectStore } from "./object-store";

export type { MarketDb } from "./exchange-rate-db";

export type MarketDeps = { db: MarketDb; store: ObjectStore; fetch: typeof globalThis.fetch };

const SOURCES = {
  ecb: {
    url: ECB_DAILY_URL,
    file: "eurofxref-daily.xml",
    derive: (db: MarketDb, raw: Uint8Array) => {
      const { day, rates } = parseEcbDaily(Buffer.from(raw).toString("utf8"));
      return replaceRates(db, [...rates].map(([currency, perEur]) => ({ day, currency, perEur })));
    },
  },
  /** The one-time load of every rate since 1999. */
  "ecb-history": {
    url: ECB_HISTORY_URL,
    file: "eurofxref-hist.zip",
    derive: (db: MarketDb, raw: Uint8Array) => replaceRates(db, parseEcbHistory(raw)),
  },
} as const;

export type MarketSource = keyof typeof SOURCES;
export const MARKET_SOURCES = Object.keys(SOURCES) as MarketSource[];

export const rawKey = (source: MarketSource, day: string) => `raw/${source}/${day}/${SOURCES[source].file}.gz`;

async function capture(deps: MarketDeps, source: MarketSource, day: string) {
  const { url } = SOURCES[source];
  const res = await deps.fetch(url);
  if (!res.ok) throw new Error(`${source}: GET ${url} answered ${res.status}`);
  await deps.store.put(rawKey(source, day), gzipSync(new Uint8Array(await res.arrayBuffer())));
  return deriveMarketDay(deps, { source, day });
}

/** `market.ecb`: today's euro reference rates. */
export const captureEcb = (deps: MarketDeps, day: string) => capture(deps, "ecb", day);

/** The one-time history load from `eurofxref-hist.zip`, back to 1999. */
export const loadEcbHistory = (deps: MarketDeps, day: string) => capture(deps, "ecb-history", day);

/** `market.derive`: rebuild a landed day's rows from its raw copy. */
export async function deriveMarketDay(
  { db, store }: Pick<MarketDeps, "db" | "store">,
  { source, day }: { source: MarketSource; day: string },
) {
  const raw = await store.get(rawKey(source, day));
  if (!raw) throw new Error(`No raw ${source} copy landed for ${day}`);
  return SOURCES[source].derive(db, gunzipSync(raw));
}
