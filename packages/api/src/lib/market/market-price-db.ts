import { tcgArtwork, tcgCard, tcgMarketPrice, tcgMarketplaceProduct, tcgPrinting } from "@life-tracker/db/schema/index";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { CardtraderBlueprint } from "./cardtrader";
import type { MarketDb } from "./exchange-rate-db";
import { type Candidate, type TcgcsvProduct, matchRule, setKey } from "./tcgcsv";
import { type ArtworkChooser, type ChoiceCandidate, baseNumber, judgeChoice } from "./typesafe-tier";

/** Rows per statement: 11k params at 11 a row, well under Postgres' 65,535 bind limit. */
const CHUNK = 1_000;

const chunks = <T>(rows: T[]) =>
  Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));

/** `excluded.<column>` in an upsert: the value the insert proposed. */
const excluded = (column: { name: string }) => sql.raw(`excluded."${column.name}"`);

type Marketplace = (typeof tcgMarketplaceProduct.$inferSelect)["marketplace"];
type Language = (typeof tcgPrinting.$inferSelect)["language"];
type PriceRow = typeof tcgMarketPrice.$inferInsert;
type StoredMatch = Pick<typeof tcgMarketplaceProduct.$inferSelect, "variantId" | "method" | "reason">;
type Product = { externalId: string; name: string; number: string; set: string; rarity: string | null; tags: string[] };
type Match =
  | { variantId: string; method: "rule" | "tcgplayer_id" }
  | { variantId: string; method: "typesafe"; confidence: number }
  /** Unmatched; `method: "typesafe"` once TypeSafe has rejected it, so it is not asked again. */
  | { reason: string; method?: "typesafe" };

/**
 * Derive TCGplayer's Market Prices for `day` from that day's TCGCSV products, in one transaction:
 * the products go through the mapping store (`upsertProducts`, rule then TypeSafe tier), then the day is
 * replaced with one NM price per English Printing of a matched Artwork, the lowest `marketPrice`
 * among its products. A null price is no row.
 */
export async function replaceTcgplayerDay(
  db: MarketDb,
  products: TcgcsvProduct[],
  day: string,
  chooser?: ArtworkChooser,
) {
  return db.transaction(async (tx) => {
    const { mapped, unmatched } = await upsertProducts(tx, "tcgplayer", products, day, async (unsettled, before) =>
      typesafeTier(tx, "tcgplayer", unsettled, await ruleTier(tx, unsettled, "en"), "en", chooser, before),
    );

    // Lowest marketPrice per Artwork, and the product it came from.
    const marketPrice = new Map(products.map((p) => [p.externalId, p.marketPrice]));
    const best = new Map<string, { price: number; productId: number }>();
    for (const m of mapped) {
      const p = marketPrice.get(m.externalId);
      if (m.variantId === null || p == null) continue;
      const current = best.get(m.variantId);
      if (!current || p < current.price) best.set(m.variantId, { price: p, productId: m.id });
    }
    const prices = (await printingsOf(tx, "en", [...best.keys()])).map((printing) => {
      const { price, productId } = best.get(printing.variantId)!;
      return {
        printingId: printing.id,
        marketplace: "tcgplayer" as const,
        condition: "NM" as const,
        day,
        price,
        listingCount: null,
        marketplaceProductId: productId,
      };
    });
    await replaceDay(tx, "tcgplayer", day, prices);
    return { products: products.length, unmatched, prices: prices.length };
  });
}

/**
 * Derive CardTrader's Market Prices for `day` from that day's blueprints and their lowest Japanese
 * Listings, in one transaction: the blueprints go through the mapping store (`tcgplayer_id` tier,
 * then the rule tier, then the TypeSafe tier), then the day is replaced with one price per Japanese Printing of a matched
 * Artwork per Condition: the lowest Listing across its blueprints, their Listing counts summed,
 * and the blueprint that supplied the lowest.
 */
export async function replaceCardtraderDay(
  db: MarketDb,
  blueprints: CardtraderBlueprint[],
  day: string,
  chooser?: ArtworkChooser,
) {
  return db.transaction(async (tx) => {
    const { mapped, unmatched } = await upsertProducts(tx, "cardtrader", blueprints, day, async (unsettled, before) => {
      const tcgplayer = await tcgplayerTier(tx, unsettled);
      // A blueprint whose TCGplayer product is marked "not an Artwork" stays so: it never reaches TypeSafe.
      const rest = unsettled.filter((b) => !tcgplayer.has(b.externalId));
      const typesafe = await typesafeTier(tx, "cardtrader", rest, await ruleTier(tx, rest, "ja"), "ja", chooser, before);
      return (b) => tcgplayer.get(b.externalId) ?? typesafe(b);
    });

    const lowest = new Map(blueprints.map((b) => [b.externalId, b.lowest]));
    const best = new Map<string, Map<PriceRow["condition"], { price: number; count: number; productId: number }>>();
    for (const m of mapped) {
      if (m.variantId === null) continue;
      const byCondition = best.get(m.variantId) ?? new Map();
      for (const [condition, listing] of Object.entries(lowest.get(m.externalId) ?? {}) as Array<
        [PriceRow["condition"], { price: number; count: number }]
      >) {
        const current = byCondition.get(condition);
        byCondition.set(condition, {
          price: Math.min(listing.price, current?.price ?? Infinity),
          count: listing.count + (current?.count ?? 0),
          productId: !current || listing.price < current.price ? m.id : current.productId,
        });
      }
      best.set(m.variantId, byCondition);
    }
    const prices = (await printingsOf(tx, "ja", [...best.keys()])).flatMap((printing) =>
      [...best.get(printing.variantId)!].map(([condition, { price, count, productId }]) => ({
        printingId: printing.id,
        marketplace: "cardtrader" as const,
        condition,
        day,
        price,
        listingCount: count,
        marketplaceProductId: productId,
      })),
    );
    await replaceDay(tx, "cardtrader", day, prices);
    return { products: blueprints.length, unmatched, prices: prices.length };
  });
}

/**
 * Upsert every product into the mapping store, refreshing its name, number, set and last seen day.
 * New and unmatched products go through `match` (built once for all of them); matched products
 * keep their Artwork (a TypeSafe match included, so TypeSafe is asked once per product), and a
 * manual row's match (or "not an Artwork") is never changed. A
 * `tcgplayer_id` match is a free lookup, so it is redone every time: a later manual fix to the
 * TCGplayer product reaches the blueprint on the next capture or replay.
 */
async function upsertProducts<P extends Product>(
  tx: MarketDb,
  marketplace: Marketplace,
  products: P[],
  day: string,
  matcher: (unsettled: P[], before: (p: P) => StoredMatch | undefined) => Promise<(p: P) => Match>,
) {
  const existing = new Map(
    (
      await tx
        .select()
        .from(tcgMarketplaceProduct)
        .where(eq(tcgMarketplaceProduct.marketplace, marketplace))
        // A manual match saved mid-derive waits for the commit instead of being upserted over.
        .for("update")
    ).map((r) => [r.externalId, r]),
  );
  const settled = (p: P) => {
    const row = existing.get(p.externalId);
    return row && (row.method === "manual" || (row.variantId !== null && row.method !== "tcgplayer_id")) ? row : null;
  };
  const match = await matcher(
    products.filter((p) => !settled(p)),
    (p) => existing.get(p.externalId),
  );

  const matchedAt = new Date();
  const rows = products.map((p) => {
    const base = { marketplace, externalId: p.externalId, name: p.name, number: p.number, set: p.set, lastSeenOn: day };
    const kept = settled(p);
    if (kept) {
      const { variantId, method, confidence, reason } = kept;
      return { ...base, variantId, method, confidence, reason, matchedAt: kept.matchedAt };
    }
    const m = match(p);
    return "variantId" in m
      ? { ...base, variantId: m.variantId, method: m.method, confidence: "confidence" in m ? m.confidence : null, reason: null, matchedAt }
      : { ...base, variantId: null, method: m.method ?? ("rule" as const), confidence: null, reason: m.reason, matchedAt: null };
  });

  const mapped: Array<{ id: number; externalId: string; variantId: string | null }> = [];
  for (const chunk of chunks(rows)) {
    const t = tcgMarketplaceProduct;
    mapped.push(
      ...(await tx
        .insert(t)
        .values(chunk)
        .onConflictDoUpdate({
          target: [t.marketplace, t.externalId],
          set: {
            name: excluded(t.name),
            number: excluded(t.number),
            set: excluded(t.set),
            variantId: excluded(t.variantId),
            method: excluded(t.method),
            confidence: excluded(t.confidence),
            reason: excluded(t.reason),
            matchedAt: excluded(t.matchedAt),
            // A replay of an older day must not move it back.
            lastSeenOn: sql`greatest(${t.lastSeenOn}, ${excluded(t.lastSeenOn)})`,
          },
        })
        .returning({ id: t.id, externalId: t.externalId, variantId: t.variantId })),
    );
  }
  return { mapped, unmatched: rows.filter((r) => r.variantId === null && r.method !== "manual").length };
}

/** Delete every price `marketplace` has for `day` and insert `prices`: a re-run or replay leaves one set. */
async function replaceDay(tx: MarketDb, marketplace: Marketplace, day: string, prices: PriceRow[]) {
  await tx.delete(tcgMarketPrice).where(and(eq(tcgMarketPrice.marketplace, marketplace), eq(tcgMarketPrice.day, day)));
  for (const chunk of chunks(prices)) await tx.insert(tcgMarketPrice).values(chunk);
}

// ponytail: one Printing per Artwork per language is the pairing's job (KOI-332); a second would get the same price.
const printingsOf = (tx: MarketDb, language: Language, variantIds: string[]) =>
  variantIds.length
    ? tx
        .select({ id: tcgPrinting.id, variantId: tcgPrinting.variantId })
        .from(tcgPrinting)
        .where(and(eq(tcgPrinting.language, language), inArray(tcgPrinting.variantId, variantIds)))
    : Promise.resolve([]);

/**
 * The `tcgplayer_id` tier: a blueprint naming a TCGplayer product takes that product's Artwork,
 * a manual match included, and is unmatched when the admin marked that product "not an Artwork".
 * One whose product is unknown or unmatched falls through to the rule tier.
 */
async function tcgplayerTier(tx: MarketDb, blueprints: CardtraderBlueprint[]) {
  const ids = [...new Set(blueprints.flatMap((b) => (b.tcgPlayerId ? [b.tcgPlayerId] : [])))];
  const products = new Map(
    ids.length
      ? (
          await tx
            .select({
              externalId: tcgMarketplaceProduct.externalId,
              variantId: tcgMarketplaceProduct.variantId,
              method: tcgMarketplaceProduct.method,
            })
            .from(tcgMarketplaceProduct)
            .where(and(eq(tcgMarketplaceProduct.marketplace, "tcgplayer"), inArray(tcgMarketplaceProduct.externalId, ids)))
        ).map((r) => [r.externalId, r])
      : [],
  );
  const matches = new Map<string, Match>();
  for (const b of blueprints) {
    const product = b.tcgPlayerId ? products.get(b.tcgPlayerId) : undefined;
    if (product?.variantId) matches.set(b.externalId, { variantId: product.variantId, method: "tcgplayer_id" });
    else if (product?.method === "manual") {
      matches.set(b.externalId, { reason: `TCGplayer product ${product.externalId} is marked not an Artwork` });
    }
  }
  return matches;
}

const LANGUAGE_NAMES: Record<Language, string> = { en: "English", ja: "Japanese" };

/** The rule tier over `products`, with candidates from `language` Printings. */
async function ruleTier(tx: MarketDb, products: Product[], language: Language) {
  const { candidates, cardNames } = await ruleCandidates(
    tx,
    products.map((p) => p.number),
    language,
  );
  return (p: Product): Match => {
    const match = matchRule(
      p,
      candidates.get(`${p.number}|${setKey(p.set)}`) ?? [],
      cardNames.get(p.number) ?? null,
      LANGUAGE_NAMES[language],
    );
    return "variantId" in match ? { ...match, method: "rule" } : match;
  };
}

/**
 * Rule-tier candidates by `<card number>|<set key>` (the Artworks with that number and a `language`
 * Printing in that set), and each Card's English name.
 */
async function ruleCandidates(db: MarketDb, numbers: string[], language: Language) {
  const candidates = new Map<string, Candidate[]>();
  const cardNames = new Map<string, string | null>();
  if (numbers.length === 0) return { candidates, cardNames };
  const rows = await db
    .selectDistinct({
      variantId: tcgArtwork.variantId,
      variantKind: tcgArtwork.variantKind,
      cardNumber: tcgArtwork.cardNumber,
      cardName: tcgCard.nameEn,
      setName: tcgPrinting.setName,
    })
    .from(tcgArtwork)
    .innerJoin(tcgCard, eq(tcgCard.number, tcgArtwork.cardNumber))
    .innerJoin(tcgPrinting, eq(tcgPrinting.variantId, tcgArtwork.variantId))
    .where(and(eq(tcgPrinting.language, language), inArray(tcgArtwork.cardNumber, [...new Set(numbers)])))
    .orderBy(tcgArtwork.variantId);
  for (const { cardNumber, cardName, setName, ...candidate } of rows) {
    const key = `${cardNumber}|${setKey(setName)}`;
    const list = candidates.get(key) ?? [];
    // Two of an Artwork's Printings can spell one set differently (`OP-05`, `OP05`): still one candidate.
    if (!list.some((c) => c.variantId === candidate.variantId)) candidates.set(key, [...list, candidate]);
    cardNames.set(cardNumber, cardName);
  }
  return { candidates, cardNames };
}

/** TypeSafe requests in flight at once. */
const TYPESAFE_CONCURRENCY = 8;

/**
 * The TypeSafe tier over `products`, after `earlier` (the tiers before it): each product `earlier`
 * leaves unmatched goes to one Choice among its card's Artworks with a `language` Printing, in any
 * set (CardTrader's `OP05-119a` is card `OP05-119`). A choice that clears the gate is a match; a
 * rejection or "none" keeps the earlier reason with the tier's appended and is stored with method
 * `typesafe`, so it is not asked again while the earlier tiers still leave it unmatched; a failed
 * request is asked again next derive. A card with no such Artwork is not asked. Without a chooser
 * the tier is skipped.
 *
 * ponytail: the requests run inside the derive's transaction, so a manual match saved meanwhile
 * waits for them (one per unmatched product, 8 at a time). Move them before the transaction if the
 * unmatched list grows to thousands. A rejection is never revisited, even after the catalog gains
 * an Artwork that would fit: reset the row's method to `rule` to have it asked again.
 */
async function typesafeTier<P extends Product>(
  tx: MarketDb,
  marketplace: Marketplace,
  products: P[],
  earlier: (p: P) => Match,
  language: Language,
  chooser: ArtworkChooser | undefined,
  before: (p: P) => StoredMatch | undefined,
) {
  const matches = new Map(products.map((p) => [p.externalId, earlier(p)]));
  const lookup = (p: P) => matches.get(p.externalId)!;
  const unmatched = products.filter((p) => {
    if (!("reason" in lookup(p))) return false;
    // Rejected before and still unmatched by the earlier tiers: keep that verdict, don't pay again.
    const stored = before(p);
    if (stored?.method !== "typesafe" || stored.variantId !== null || !stored.reason) return true;
    matches.set(p.externalId, { reason: stored.reason, method: "typesafe" });
    return false;
  });
  if (!chooser || unmatched.length === 0) return lookup;

  const candidates = await typesafeCandidates(
    tx,
    unmatched.map((p) => baseNumber(p.number)),
    language,
  );
  const ask = async ({ externalId, name, number, set, rarity, tags }: P) => {
    const list = candidates.get(baseNumber(number));
    if (!list) return;
    const verdict = await chooser({ marketplace, name, number, set, rarity, tags }, list).then(
      (answer) => ({ ...judgeChoice(answer, list), method: "typesafe" as const }),
      // Not a verdict: the product stays a rule-tier row, so the next derive asks again.
      (err: Error) => ({ reason: `TypeSafe tier failed: ${err.message}` }),
    );
    const { reason } = matches.get(externalId) as { reason: string };
    matches.set(externalId, "variantId" in verdict ? { ...verdict, method: "typesafe" } : { ...verdict, reason: `${reason}; ${verdict.reason}` });
  };
  for (let i = 0; i < unmatched.length; i += TYPESAFE_CONCURRENCY) {
    await Promise.all(unmatched.slice(i, i + TYPESAFE_CONCURRENCY).map(ask));
  }
  return lookup;
}

/** TypeSafe-tier candidates by card number: every Artwork of it with a `language` Printing, and those Printings' sets. */
async function typesafeCandidates(db: MarketDb, numbers: string[], language: Language) {
  const rows = await db
    .selectDistinct({
      cardNumber: tcgArtwork.cardNumber,
      variantId: tcgArtwork.variantId,
      variantKind: tcgArtwork.variantKind,
      rarity: tcgArtwork.rarity,
      artist: tcgArtwork.artist,
      setName: tcgPrinting.setName,
    })
    .from(tcgArtwork)
    .innerJoin(tcgPrinting, eq(tcgPrinting.variantId, tcgArtwork.variantId))
    .where(and(eq(tcgPrinting.language, language), inArray(tcgArtwork.cardNumber, [...new Set(numbers)])))
    .orderBy(tcgArtwork.variantId, tcgPrinting.setName);
  const candidates = new Map<string, ChoiceCandidate[]>();
  for (const { cardNumber, setName, ...artwork } of rows) {
    const list = candidates.get(cardNumber) ?? [];
    const known = list.find((c) => c.variantId === artwork.variantId);
    if (known) known.sets.push(setName);
    else candidates.set(cardNumber, [...list, { ...artwork, sets: [setName] }]);
  }
  return candidates;
}
