import { asc, eq, ilike, inArray, isNotNull, ne, notExists, sql } from "drizzle-orm";

import { db } from "@life-tracker/db";
import {
  tcgArtRating,
  tcgArtwork,
  tcgArtworkTheme,
  tcgCard,
  tcgOffer,
  tcgPrinting,
  tcgWant,
} from "@life-tracker/db/schema/index";

import type { transformCatalog } from "./catalog-transform";
import type { ArtistUpdate } from "./limitless";

/** Rows per insert, well under Postgres' 65535 bind-parameter limit. */
const CHUNK = 1000;

const chunks = <T>(rows: T[]) =>
  Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));

/** An Offer whose Printing was re-paired off its Want's Artwork: fix by hand. */
export type OfferMismatch = { offerId: string; wantVariantId: string; printingVariantId: string; listId: string | null };

/**
 * Idempotent catalog upsert, keyed by card number, variant ID and a Printing's
 * (language, list ID). Only writes catalog columns: an Artwork's artist,
 * artist-conflict flag and a manga kind from Limitless (KOI-306), and every
 * per-user table, are left alone.
 *
 * Re-pairing (KOI-332) moves a Printing to another Artwork in place, so its
 * Copies and Offers follow the physical print. An Artwork left with no
 * Printing is deleted, unless one carries an Art Rating, Theme tag or Want:
 * then the whole import rolls back and the error lists them.
 */
export async function upsertCatalog(
  catalog: ReturnType<typeof transformCatalog>,
): Promise<{ deleted: string[]; offerMismatches: OfferMismatch[] }> {
  return db.transaction(async (tx) => {
    for (const rows of chunks(catalog.cards)) {
      await tx
        .insert(tcgCard)
        .values(rows)
        .onConflictDoUpdate({
          target: tcgCard.number,
          set: { nameEn: sql`excluded.name_en`, nameJa: sql`excluded.name_ja` },
        });
    }
    for (const rows of chunks(catalog.artworks)) {
      await tx
        .insert(tcgArtwork)
        .values(rows)
        .onConflictDoUpdate({
          target: tcgArtwork.variantId,
          // A manga set from Limitless's label (KOI-306) outranks the import's heuristic.
          set: {
            cardNumber: sql`excluded.card_number`,
            rarity: sql`excluded.rarity`,
            variantKind: sql`case when ${tcgArtwork.variantKind} = 'manga' then ${tcgArtwork.variantKind} else excluded.variant_kind end`,
          },
        });
    }
    for (const rows of chunks(catalog.printings)) {
      await tx
        .insert(tcgPrinting)
        .values(rows)
        .onConflictDoUpdate({
          target: [tcgPrinting.language, tcgPrinting.listId],
          set: {
            variantId: sql`excluded.variant_id`,
            packId: sql`excluded.pack_id`,
            setName: sql`excluded.set_name`,
            imageUrl: sql`excluded.image_url`,
          },
        });
    }

    const orphans = await tx
      .select({ variantId: tcgArtwork.variantId })
      .from(tcgArtwork)
      .where(notExists(tx.select().from(tcgPrinting).where(eq(tcgPrinting.variantId, tcgArtwork.variantId))));
    const deleted = orphans.map((o) => o.variantId);
    if (deleted.length) {
      const held = [
        ...(await tx.select({ variantId: tcgArtRating.variantId }).from(tcgArtRating).where(inArray(tcgArtRating.variantId, deleted))),
        ...(await tx.select({ variantId: tcgArtworkTheme.variantId }).from(tcgArtworkTheme).where(inArray(tcgArtworkTheme.variantId, deleted))),
        ...(await tx.select({ variantId: tcgWant.variantId }).from(tcgWant).where(inArray(tcgWant.variantId, deleted))),
      ];
      if (held.length) {
        const ids = [...new Set(held.map((h) => h.variantId))].toSorted();
        throw new Error(`Import rolled back: Artworks left without Printings carry an Art Rating, Theme tag or Want: ${ids.join(", ")}`);
      }
      await tx.delete(tcgArtwork).where(inArray(tcgArtwork.variantId, deleted));
    }

    const offerMismatches = await tx
      .select({
        offerId: tcgOffer.id,
        wantVariantId: tcgWant.variantId,
        printingVariantId: tcgPrinting.variantId,
        listId: tcgPrinting.listId,
      })
      .from(tcgOffer)
      .innerJoin(tcgWant, eq(tcgWant.id, tcgOffer.wantId))
      .innerJoin(tcgPrinting, eq(tcgPrinting.id, tcgOffer.printingId))
      .where(ne(tcgPrinting.variantId, tcgWant.variantId));
    return { deleted, offerMismatches };
  });
}

/**
 * The last import's pairings for `pairEnglish` (KOI-332): each English list ID's
 * Artwork (null = English-only) and the Japanese variants already imported.
 */
export async function storedPairings(): Promise<{ pairs: Map<string, string | null>; ja: Set<string> }> {
  const rows = await db
    .select({ language: tcgPrinting.language, listId: tcgPrinting.listId, variantId: tcgPrinting.variantId })
    .from(tcgPrinting)
    .where(isNotNull(tcgPrinting.listId));
  const pairs = new Map<string, string | null>();
  const ja = new Set<string>();
  for (const r of rows) {
    if (r.language === "ja") ja.add(r.listId!);
    else if (r.language === "en") pairs.set(r.listId!, r.variantId.startsWith("EN-") ? null : r.variantId);
  }
  return { pairs, ja };
}

/**
 * Artworks grouped by Card, optionally only Cards with a Printing in one set
 * (`OP-05`, any case), each with one Printing's Bandai image to compare art against: the
 * Japanese one when it exists, since an Artwork is its Japanese variant ID (ADR 0006).
 */
export async function artworksByCard(
  set?: string,
): Promise<Map<string, Array<{ variantId: string; artist: string | null; imageUrl: string | null }>>> {
  const inSet = set
    ? inArray(
        tcgArtwork.cardNumber,
        db
          .selectDistinct({ cardNumber: tcgArtwork.cardNumber })
          .from(tcgArtwork)
          .innerJoin(tcgPrinting, eq(tcgPrinting.variantId, tcgArtwork.variantId))
          .where(ilike(tcgPrinting.setName, set)),
      )
    : undefined;
  const rows = await db
    .select({
      cardNumber: tcgArtwork.cardNumber,
      variantId: tcgArtwork.variantId,
      artist: tcgArtwork.artist,
      imageUrl: tcgPrinting.imageUrl,
    })
    .from(tcgArtwork)
    .leftJoin(tcgPrinting, eq(tcgPrinting.variantId, tcgArtwork.variantId))
    .where(inSet)
    // Postgres sorts an enum in declaration order: `ja` before `en`.
    .orderBy(asc(tcgArtwork.variantId), asc(tcgPrinting.language));
  const artworks = [...Map.groupBy(rows, (r) => r.variantId).values()].map(([first]) => first!);
  return Map.groupBy(artworks, (r) => r.cardNumber);
}

/**
 * Write the Limitless artist backfill (KOI-306) for one Card's Artworks. Only
 * touches artist, the conflict flag, and promotes a variant to manga; Artworks
 * missing from the catalog are skipped.
 * ponytail: never demotes a manga; a wrong manga kind is fixed by hand.
 */
export async function applyArtistUpdates(updates: ArtistUpdate[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const u of updates) {
      await tx
        .update(tcgArtwork)
        .set({
          artist: u.artist,
          artistConflict: u.artistConflict,
          ...(u.manga && { variantKind: "manga" as const }),
        })
        .where(eq(tcgArtwork.variantId, u.variantId));
    }
  });
}
