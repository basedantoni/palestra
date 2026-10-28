/**
 * Market Watch capture jobs (KOI-364, KOI-366, KOI-369, ADR 0008): fetch a source, land the raw response
 * gzipped at `raw/<source>/<day>/`, then derive rows from the landed copy, never from the live
 * response. A replay (`market.derive`) runs the same derive step on a day already landed.
 *
 * `<day>` is the capture's UTC day. ECB rows' day comes from the data: a Saturday capture of
 * `eurofxref-daily.xml` holds Friday's rates and replaces Friday. Market Prices' day is the capture's.
 */
import { gunzipSync, gzipSync } from "node:zlib";

import { type Clock, throttledFetch } from "../tcg/throttled-fetch";
import {
  CARDTRADER_EXPANSIONS_URL,
  CARDTRADER_LANGUAGES,
  type CardtraderBundle,
  cardtraderBlueprintsUrl,
  cardtraderListingsUrl,
  parseCardtrader,
  parseCardtraderExpansions,
} from "./cardtrader";
import { ECB_DAILY_URL, ECB_HISTORY_URL, parseEcbDaily, parseEcbHistory } from "./ecb";
import { type MarketDb, ratesOn, replaceRates } from "./exchange-rate-db";
import { replaceCardtraderDay, replaceTcgplayerDay } from "./market-price-db";
import type { ObjectStore } from "./object-store";
import { TCGCSV_GROUPS_URL, type TcgcsvBundle, parseTcgcsv, parseTcgcsvGroups, tcgcsvGroupUrl } from "./tcgcsv";

export type { MarketDb } from "./exchange-rate-db";

export type MarketDeps = {
  db: MarketDb;
  store: ObjectStore;
  fetch: typeof globalThis.fetch;
  /** CardTrader's self-serve API token; only `market.cardtrader` needs it. */
  cardtraderToken?: string;
  /** The CardTrader throttle's clock: the system's unless a test injects one. */
  clock?: Clock;
};
type Fetch = MarketDeps["fetch"];

/** TCGCSV answers 401 to a request without one, and Node's fetch sends none. */
const USER_AGENT = "palestra-market-watch/1.0";

async function get(fetch: Fetch, url: string) {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
  return res;
}

const download = (url: string) => async ({ fetch }: MarketDeps) =>
  new Uint8Array(await (await get(fetch, url)).arrayBuffer());

/** The groups response, then each group's products and prices, as one JSON bundle: ~180 requests, one at a time. */
async function downloadTcgcsv({ fetch }: MarketDeps) {
  const groups: unknown = await (await get(fetch, TCGCSV_GROUPS_URL)).json();
  const bundle: TcgcsvBundle = { groups, products: {}, prices: {} };
  for (const id of parseTcgcsvGroups(groups)) {
    bundle.products[id] = await (await get(fetch, tcgcsvGroupUrl(id, "products"))).json();
    bundle.prices[id] = await (await get(fetch, tcgcsvGroupUrl(id, "prices"))).json();
  }
  return new TextEncoder().encode(JSON.stringify(bundle));
}

/** CardTrader's ToS exception (ADR 0007) allows at most 1 request per second. */
const CARDTRADER_DELAY_MS = 1_000;

/**
 * The expansions response, then each One Piece expansion's blueprints and its Listings in each
 * captured language, as one JSON bundle: one pass, read-only, at most 1 request per second. Only
 * the Listings calls carry prices, and each is language-filtered.
 */
async function downloadCardtrader({ fetch, clock, cardtraderToken }: MarketDeps) {
  if (!cardtraderToken) throw new Error("CARDTRADER_TOKEN is not set");
  const throttled = throttledFetch(CARDTRADER_DELAY_MS, USER_AGENT, { fetch, clock });
  const json = async (url: string): Promise<unknown> => {
    const res = await throttled(url, { authorization: `Bearer ${cardtraderToken}` });
    if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
    return res.json();
  };
  const expansions = await json(CARDTRADER_EXPANSIONS_URL);
  const bundle: CardtraderBundle = { expansions, blueprints: {}, products: {} };
  for (const id of parseCardtraderExpansions(expansions)) {
    bundle.blueprints[id] = await json(cardtraderBlueprintsUrl(id));
    for (const language of CARDTRADER_LANGUAGES) {
      (bundle.products[language] ??= {})[id] = await json(cardtraderListingsUrl(id, language));
    }
  }
  return new TextEncoder().encode(JSON.stringify(bundle));
}

const utf8 = (raw: Uint8Array) => Buffer.from(raw).toString("utf8");

type Source = {
  download: (deps: MarketDeps) => Promise<Uint8Array>;
  file: string;
  derive: (db: MarketDb, raw: Uint8Array, day: string) => Promise<unknown>;
};

const SOURCES = {
  ecb: {
    download: download(ECB_DAILY_URL),
    file: "eurofxref-daily.xml",
    derive: (db, raw) => {
      const { day, rates } = parseEcbDaily(utf8(raw));
      return replaceRates(db, [...rates].map(([currency, perEur]) => ({ day, currency, perEur })));
    },
  },
  /** The one-time load of every rate since 1999. */
  "ecb-history": {
    download: download(ECB_HISTORY_URL),
    file: "eurofxref-hist.zip",
    derive: (db, raw) => replaceRates(db, parseEcbHistory(raw)),
  },
  /** TCGplayer's English Market Prices, via TCGCSV. */
  tcgcsv: {
    download: downloadTcgcsv,
    file: "tcgcsv.json",
    derive: (db, raw, day) => replaceTcgplayerDay(db, parseTcgcsv(JSON.parse(utf8(raw)) as TcgcsvBundle), day),
  },
  /** CardTrader's Japanese Market Prices; a non-EUR Listing converts at the latest rate on or before the day. */
  cardtrader: {
    download: downloadCardtrader,
    file: "cardtrader.json",
    derive: async (db, raw, day) => {
      const bundle = JSON.parse(utf8(raw)) as CardtraderBundle;
      const { blueprints, skipped } = parseCardtrader(bundle, "jp", await ratesOn(db, day));
      return { ...(await replaceCardtraderDay(db, blueprints, day)), skipped };
    },
  },
} satisfies Record<string, Source>;

export type MarketSource = keyof typeof SOURCES;
export const MARKET_SOURCES = Object.keys(SOURCES) as MarketSource[];

export const rawKey = (source: MarketSource, day: string) => `raw/${source}/${day}/${SOURCES[source].file}.gz`;

async function capture(deps: MarketDeps, source: MarketSource, day: string) {
  const raw = await SOURCES[source].download(deps).catch((err: Error) => {
    throw new Error(`${source}: ${err.message}`, { cause: err });
  });
  await deps.store.put(rawKey(source, day), gzipSync(raw));
  return deriveMarketDay(deps, { source, day });
}

/** `market.ecb`: today's euro reference rates. */
export const captureEcb = (deps: MarketDeps, day: string) => capture(deps, "ecb", day);

/** The one-time history load from `eurofxref-hist.zip`, back to 1999. */
export const loadEcbHistory = (deps: MarketDeps, day: string) => capture(deps, "ecb-history", day);

/** `market.tcgcsv`: today's TCGplayer Market Prices. */
export const captureTcgcsv = (deps: MarketDeps, day: string) => capture(deps, "tcgcsv", day);

/** `market.cardtrader`: today's CardTrader Japanese Market Prices. */
export const captureCardtrader = (deps: MarketDeps, day: string) => capture(deps, "cardtrader", day);

/** `market.derive`: rebuild a landed day's rows from its raw copy. */
export async function deriveMarketDay(
  { db, store }: Pick<MarketDeps, "db" | "store">,
  { source, day }: { source: MarketSource; day: string },
) {
  const raw = await store.get(rawKey(source, day));
  if (!raw) throw new Error(`No raw ${source} copy landed for ${day}`);
  return SOURCES[source].derive(db, gunzipSync(raw), day);
}
