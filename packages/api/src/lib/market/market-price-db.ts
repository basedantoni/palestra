import { tcgArtwork, tcgCard, tcgMarketPrice, tcgMarketplaceProduct, tcgPrinting } from "@life-tracker/db/schema/index";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { CardtraderBlueprint } from "./cardtrader";
import type { MarketDb } from "./exchange-rate-db";
import { type Candidate, type TcgcsvProduct, matchRule, setKey } from "./tcgcsv";

/** Rows per statement: 11k params at 11 a row, well under Postgres' 65,535 bind limit. */
const CHUNK = 1_000;

const chunks = <T>(rows: T[]) =>
  Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));

/** `excluded.<column>` in an upsert: the value the insert proposed. */
const excluded = (column: { name: string }) => sql.raw(`excluded."${column.name}"`);

type Marketplace = (typeof tcgMarketplaceProduct.$inferSelect)["marketplace"];
type Language = (typeof tcgPrinting.$inferSelect)["language"];
type PriceRow = typeof tcgMarketPrice.$inferInsert;
type Product = { externalId: string; name: string; number: string; set: string; tags: string[] };
type Match = { variantId: string; method: "rule" | "tcgplayer_id" } | { reason: string };

/**
 * Derive TCGplayer's Market Prices for `day` from that day's TCGCSV products, in one transaction:
 * the products go through the mapping store (`upsertProducts`, rule tier), then the day is
 * replaced with one NM price per English Printing of a matched Artwork, the lowest `marketPrice`
 * among its products. A null price is no row.
 */
export async function replaceTcgplayerDay(db: MarketDb, products: TcgcsvProduct[], day: string) {
  return db.transaction(async (tx) => {
    const { mapped, unmatched } = await upsertProducts(tx, "tcgplayer", products, day, (unsettled) =>
      ruleTier(tx, unsettled, "en"),
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
 * then the rule tier), then the day is replaced with one price per Japanese Printing of a matched
 * Artwork per Condition: the lowest Listing across its blueprints, their Listing counts summed,
 * and the blueprint that supplied the lowest.
 */
export async function replaceCardtraderDay(db: MarketDb, blueprints: CardtraderBlueprint[], day: string) {
  return db.transaction(async (tx) => {
    const { mapped, unmatched } = await upsertProducts(tx, "cardtrader", blueprints, day, async (unsettled) => {
      const tcgplayer = await tcgplayerTier(tx, unsettled);
      const rule = await ruleTier(
        tx,
        unsettled.filter((b) => !tcgplayer.has(b.externalId)),
        "ja",
      );
      return (b) => tcgplayer.get(b.externalId) ?? rule(b);
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
 * keep their Artwork, and a manual row's match (or "not an Artwork") is never changed. A
 * `tcgplayer_id` match is a free lookup, so it is redone every time: a later manual fix to the
 * TCGplayer product reaches the blueprint on the next capture or replay.
 */
async function upsertProducts<P extends Product>(
  tx: MarketDb,
  marketplace: Marketplace,
  products: P[],
  day: string,
  matcher: (unsettled: P[]) => Promise<(p: P) => Match>,
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
  const match = await matcher(products.filter((p) => !settled(p)));

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
      ? { ...base, variantId: m.variantId, method: m.method, confidence: null, reason: null, matchedAt }
      : { ...base, variantId: null, method: "rule" as const, confidence: null, reason: m.reason, matchedAt: null };
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
