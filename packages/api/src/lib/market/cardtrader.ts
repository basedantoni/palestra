/**
 * CardTrader Listings (KOI-369, ADR 0007): the API's URLs and the parser for a day's landed
 * responses. Pure: no HTTP, no DB.
 *
 * CardTrader publishes Listings, not an aggregate: per One Piece expansion, its blueprints (one
 * per Artwork, across languages) and, per language, the cheapest Listings of each blueprint.
 */
import type { TCG_CONDITIONS } from "@life-tracker/shared";
import { z } from "zod";

import type { PerEur } from "./ecb";

const API = "https://api.cardtrader.com/api/v2";
/** CardTrader's catalog number for the One Piece Card Game. */
const ONE_PIECE_GAME_ID = 15;

export const CARDTRADER_EXPANSIONS_URL = `${API}/expansions`;
export const cardtraderBlueprintsUrl = (expansionId: number) => `${API}/blueprints/export?expansion_id=${expansionId}`;
export const cardtraderListingsUrl = (expansionId: number, language: CardtraderLanguage) =>
  `${API}/marketplace/products?expansion_id=${expansionId}&language=${language}`;

/**
 * The Listing languages captured, as CardTrader names them. The ToS exception (ADR 0007) allows
 * `jp`, `zh-CN` and `kr` only; `zh-CN` and `kr` come with KOI-372.
 */
export const CARDTRADER_LANGUAGES = ["jp"] as const;
export type CardtraderLanguage = (typeof CARDTRADER_LANGUAGES)[number];

/**
 * One capture as landed: the raw expansions response, each One Piece expansion's blueprints
 * response, and per language each expansion's Listings response, by expansion id.
 */
export type CardtraderBundle = {
  expansions: unknown;
  blueprints: Record<string, unknown>;
  listings: Partial<Record<CardtraderLanguage, Record<string, unknown>>>;
};

const expansionsResponse = z.array(z.object({ id: z.number(), game_id: z.number(), code: z.string().nullish(), name: z.string() }));
const blueprintsResponse = z.array(
  z.object({
    id: z.number(),
    name: z.string(),
    version: z.string().nullish(),
    expansion_id: z.number(),
    tcg_player_id: z.number().nullish(),
    fixed_properties: z
      .object({ collector_number: z.string().nullish(), onepiece_rarity: z.string().nullish() })
      .nullish(),
  }),
);
const listingsResponse = z.record(
  z.string(),
  z.array(
    z.object({
      price: z.object({ cents: z.number(), currency: z.string() }),
      graded: z.boolean().nullish(),
      properties_hash: z.object({
        condition: z.string().optional(),
        onepiece_language: z.string().optional(),
        signed: z.boolean().nullish(),
        altered: z.boolean().nullish(),
      }),
    }),
  ),
);

/** The One Piece expansions to fetch blueprints and Listings for. */
export const parseCardtraderExpansions = (expansions: unknown) =>
  expansionsResponse
    .parse(expansions)
    .filter((e) => e.game_id === ONE_PIECE_GAME_ID)
    .map((e) => e.id);

type Condition = (typeof TCG_CONDITIONS)[number];

const CONDITIONS: Record<string, Condition> = {
  Mint: "NM",
  "Near Mint": "NM",
  "Slightly Played": "LP",
  "Moderately Played": "MP",
  Played: "HP",
  "Heavily Played": "HP",
  Poor: "DMG",
};

/** A Listing's Condition, or null for one CardTrader names that has no mapping. */
export const cardtraderCondition = (condition: string | undefined): Condition | null =>
  (condition !== undefined && Object.hasOwn(CONDITIONS, condition) && CONDITIONS[condition]) || null;

/** Minor units per major unit: 100 for EUR, 1 for JPY. */
const minorUnits = (currency: string) =>
  10 ** new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits!;

export type CardtraderBlueprint = {
  /** CardTrader blueprint id. */
  externalId: string;
  name: string;
  number: string;
  /** The expansion's code (`op05`), or its name when it has none. */
  set: string;
  /** The blueprint's `version` (`Parallel`, `Manga`), when it has one. */
  tags: string[];
  /** The TCGplayer product it is, when CardTrader knows it. */
  tcgPlayerId: string | null;
  /** The lowest Listing in EUR per Condition, and how many Listings it was drawn from. */
  lowest: Partial<Record<Condition, { price: number; count: number }>>;
};

/**
 * Every card blueprint in the bundle with its `language` Listings. Blueprints with no collector
 * number (sealed product) or of rarity DON!! are dropped. Graded, signed and altered Listings, and
 * any in another language, count toward neither the lowest price nor the count. Listings are priced
 * in the token account's currency (USD, seen 2026-10-28), so a non-EUR Listing is converted at
 * `rates` before the lowest is taken; one with no rate, or with a missing or unmapped Condition, is
 * skipped and reported.
 */
export function parseCardtrader(bundle: CardtraderBundle, language: CardtraderLanguage, rates: PerEur) {
  const skipped = { conditions: new Set<string>(), currencies: new Set<string>() };
  const blueprints: CardtraderBlueprint[] = [];
  const sets = new Map(expansionsResponse.parse(bundle.expansions).map((e) => [e.id, e.code || e.name]));
  for (const [expansionId, raw] of Object.entries(bundle.blueprints)) {
    const listingsRaw = bundle.listings[language]?.[expansionId];
    const listings = listingsRaw ? listingsResponse.parse(listingsRaw) : {};
    for (const b of blueprintsResponse.parse(raw)) {
      const number = b.fixed_properties?.collector_number;
      if (!number || b.fixed_properties?.onepiece_rarity === "DON!!") continue;
      const lowest: CardtraderBlueprint["lowest"] = {};
      for (const l of listings[b.id] ?? []) {
        const p = l.properties_hash;
        if (l.graded || p.signed || p.altered || p.onepiece_language !== language) continue;
        const condition = cardtraderCondition(p.condition);
        if (!condition) {
          // Real responses have Listings with no condition at all (2026-10-28).
          skipped.conditions.add(p.condition ?? "(none)");
          continue;
        }
        const { cents, currency } = l.price;
        const perEur = currency === "EUR" ? 1 : rates.get(currency);
        if (perEur === undefined) {
          skipped.currencies.add(currency);
          continue;
        }
        const price = cents / minorUnits(currency) / perEur;
        const current = lowest[condition];
        lowest[condition] = { price: Math.min(price, current?.price ?? Infinity), count: (current?.count ?? 0) + 1 };
      }
      blueprints.push({
        externalId: String(b.id),
        name: b.name,
        number,
        set: sets.get(b.expansion_id) ?? expansionId,
        tags: b.version ? [b.version] : [],
        tcgPlayerId: b.tcg_player_id ? String(b.tcg_player_id) : null,
        lowest,
      });
    }
  }
  return { blueprints, skipped: { conditions: [...skipped.conditions], currencies: [...skipped.currencies] } };
}
