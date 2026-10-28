import { tcgArtwork, tcgCard, tcgMarketPrice, tcgMarketplaceProduct, tcgPrinting } from "@life-tracker/db/schema/index";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { MarketDb } from "./exchange-rate-db";
import { type Candidate, type TcgcsvProduct, matchRule, setKey } from "./tcgcsv";

/** Rows per statement: 11k params at 11 a row, well under Postgres' 65,535 bind limit. */
const CHUNK = 1_000;

const chunks = <T>(rows: T[]) =>
  Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));

/** `excluded.<column>` in an upsert: the value the insert proposed. */
const excluded = (column: { name: string }) => sql.raw(`excluded."${column.name}"`);

/**
 * Derive TCGplayer's Market Prices for `day` from that day's TCGCSV products, in one transaction:
 *
 * 1. Upsert every product into the mapping store, refreshing its name, number, set and last seen
 *    day. New and unmatched products go through the rule tier; matched products keep their Artwork,
 *    and a manual row's match (or "not an Artwork") is never changed.
 * 2. Replace the day: delete every TCGplayer price for it, insert one NM price per English Printing
 *    of a matched Artwork, the lowest `marketPrice` among its products. A null price is no row.
 */
export async function replaceTcgplayerDay(db: MarketDb, products: TcgcsvProduct[], day: string) {
  return db.transaction(async (tx) => {
    const existing = new Map(
      (
        await tx
          .select()
          .from(tcgMarketplaceProduct)
          .where(eq(tcgMarketplaceProduct.marketplace, "tcgplayer"))
      ).map((r) => [r.externalId, r]),
    );
    const settled = (p: TcgcsvProduct) => {
      const row = existing.get(p.externalId);
      return row && (row.variantId !== null || row.method === "manual") ? row : null;
    };
    const { candidates, cardNames } = await ruleCandidates(
      tx,
      products.filter((p) => !settled(p)).map((p) => p.number),
    );

    const matchedAt = new Date();
    const rows = products.map((p) => {
      const base = { marketplace: "tcgplayer" as const, externalId: p.externalId, name: p.name, number: p.number, set: p.set, lastSeenOn: day };
      const kept = settled(p);
      if (kept) {
        const { variantId, method, confidence, reason } = kept;
        return { ...base, variantId, method, confidence, reason, matchedAt: kept.matchedAt };
      }
      const match = matchRule(p, candidates.get(`${p.number}|${setKey(p.set)}`) ?? [], cardNames.get(p.number) ?? null);
      return "variantId" in match
        ? { ...base, variantId: match.variantId, method: "rule" as const, confidence: null, reason: null, matchedAt }
        : { ...base, variantId: null, method: "rule" as const, confidence: null, reason: match.reason, matchedAt: null };
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

    // Lowest marketPrice per Artwork, and the product it came from.
    const marketPrice = new Map(products.map((p) => [p.externalId, p.marketPrice]));
    const best = new Map<string, { price: number; productId: number }>();
    for (const m of mapped) {
      const p = marketPrice.get(m.externalId);
      if (m.variantId === null || p == null) continue;
      const current = best.get(m.variantId);
      if (!current || p < current.price) best.set(m.variantId, { price: p, productId: m.id });
    }
    // ponytail: one English Printing per Artwork is the pairing's job (KOI-332); a second would get the same price.
    const printings = best.size
      ? await tx
          .select({ id: tcgPrinting.id, variantId: tcgPrinting.variantId })
          .from(tcgPrinting)
          .where(and(eq(tcgPrinting.language, "en"), inArray(tcgPrinting.variantId, [...best.keys()])))
      : [];
    const prices = printings.map((printing) => {
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

    await tx
      .delete(tcgMarketPrice)
      .where(and(eq(tcgMarketPrice.marketplace, "tcgplayer"), eq(tcgMarketPrice.day, day)));
    for (const chunk of chunks(prices)) await tx.insert(tcgMarketPrice).values(chunk);

    return {
      products: rows.length,
      unmatched: rows.filter((r) => r.variantId === null && r.method !== "manual").length,
      prices: prices.length,
    };
  });
}

/**
 * Rule-tier candidates by `<card number>|<set key>` (the Artworks with that number and an English
 * Printing in that set), and each Card's English name.
 */
async function ruleCandidates(db: MarketDb, numbers: string[]) {
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
    .where(and(eq(tcgPrinting.language, "en"), inArray(tcgArtwork.cardNumber, [...new Set(numbers)])))
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
