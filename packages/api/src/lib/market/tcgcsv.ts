/**
 * TCGplayer prices via TCGCSV (KOI-366, ADR 0007): the parser for a day's landed responses and the
 * matcher's rule tier. Pure: no HTTP, no DB.
 *
 * TCGCSV mirrors TCGplayer's catalog once a day as JSON: the One Piece category's groups (sets),
 * and per group its products and their prices, one price row per sub-type (Normal, Foil).
 */
import { z } from "zod";

/** TCGplayer's One Piece Card Game category. */
const CATEGORY = 68;
export const TCGCSV_GROUPS_URL = `https://tcgcsv.com/tcgplayer/${CATEGORY}/groups`;
export const tcgcsvGroupUrl = (groupId: number, file: "products" | "prices") =>
  `https://tcgcsv.com/tcgplayer/${CATEGORY}/${groupId}/${file}`;

/** One capture as landed: the raw groups response, and each group's products and prices responses by group id. */
export type TcgcsvBundle = {
  groups: unknown;
  products: Record<string, unknown>;
  prices: Record<string, unknown>;
};

const response = <T extends z.ZodType>(item: T) =>
  z
    .object({ success: z.boolean().optional(), errors: z.array(z.unknown()).optional(), results: z.array(item) })
    .refine((r) => r.success !== false, { message: "TCGCSV reported a failed response" });

const groupsResponse = response(
  z.object({ groupId: z.number(), name: z.string(), abbreviation: z.string().nullish() }),
);
const productsResponse = response(
  z.object({
    productId: z.number(),
    name: z.string(),
    groupId: z.number(),
    extendedData: z.array(z.object({ name: z.string(), value: z.string() })),
  }),
);
const pricesResponse = response(
  z.object({ productId: z.number(), marketPrice: z.number().nullable(), subTypeName: z.string() }),
);

/** The groups to fetch products and prices for. */
export const parseTcgcsvGroups = (groups: unknown) => groupsResponse.parse(groups).results.map((g) => g.groupId);

export type TcgcsvProduct = {
  /** TCGplayer `productId`. */
  externalId: string;
  name: string;
  number: string;
  /** The group's abbreviation (`OP05`), or its name when it has none. */
  set: string;
  /**
   * The name's parentheticals other than a number (`Sabo (001)`, `Izo (OP03-003)`): `Parallel`,
   * `SP`, `Alternate Art`, or an alias that belongs to the Card's name (`Mr.3 (Galdino)`).
   */
  tags: string[];
  /** USD, stored as the NM Market Price. Null = no price that day. */
  marketPrice: number | null;
};

/**
 * Every card product in the bundle. Products with no `Number` (sealed product, DON!!) are dropped.
 * The Normal sub-type's `marketPrice` wins over Foil's; a null `marketPrice` stays null, never
 * `lowPrice`.
 */
export function parseTcgcsv(bundle: TcgcsvBundle): TcgcsvProduct[] {
  const products: TcgcsvProduct[] = [];
  for (const group of groupsResponse.parse(bundle.groups).results) {
    const set = group.abbreviation || group.name;
    const prices = new Map<number, { marketPrice: number | null; subTypeName: string }>();
    const priceRows = bundle.prices[group.groupId];
    for (const p of priceRows ? pricesResponse.parse(priceRows).results : []) {
      if (!prices.has(p.productId) || p.subTypeName === "Normal") prices.set(p.productId, p);
    }
    const productRows = bundle.products[group.groupId];
    for (const p of productRows ? productsResponse.parse(productRows).results : []) {
      const number = p.extendedData.find((e) => e.name === "Number")?.value;
      if (!number) continue;
      products.push({
        externalId: String(p.productId),
        name: p.name,
        number,
        set,
        tags: parentheticals(p.name).filter((t) => !/^\d+$/.test(t) && !/^[A-Z]+\d*-\d+$/.test(t)),
        marketPrice: prices.get(p.productId)?.marketPrice ?? null,
      });
    }
  }
  return products;
}

/** The text of each `(…)` and `[…]` in a name. */
const parentheticals = (name: string) =>
  [...name.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map(([, paren, bracket]) => (paren ?? bracket ?? "").trim());

/** A set name compared across Marketplaces and the catalog: `OP-05`, `OP05` and `op05` are one set. */
export const setKey = (set: string) => set.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

export type Candidate = { variantId: string; variantKind: "base" | "parallel" | "manga" | "reprint" };

/**
 * The rule tier: `candidates` are the Artworks with the product's card number that have a Printing
 * in its set, in the Marketplace's language (English for TCGplayer, Japanese for CardTrader). An
 * untagged product goes to the base Artwork, a tagged one to the others; a single candidate is a
 * match, anything else leaves the product unmatched with a reason. A tag that is part of the
 * Card's English name (`Mr.3(Galdino)`) does not count.
 */
export function matchRule(
  product: Pick<TcgcsvProduct, "number" | "set" | "tags">,
  candidates: Candidate[],
  cardName: string | null,
  language = "English",
): { variantId: string } | { reason: string } {
  const aliases = parentheticals(cardName ?? "");
  const tagged = product.tags.some((t) => !aliases.includes(t));
  const fitting = candidates.filter((c) => (c.variantKind === "base") !== tagged);
  if (fitting.length === 1) return { variantId: fitting[0]!.variantId };
  if (fitting.length > 1) {
    return { reason: `${fitting.length} candidate Artworks in ${product.set}: ${fitting.map((c) => c.variantId).join(", ")}` };
  }
  const kind = candidates.length === 0 ? "" : tagged ? "non-base " : "base ";
  return { reason: `No ${kind}Artwork of ${product.number} has ${language === "English" ? "an" : "a"} ${language} Printing in ${product.set}` };
}
