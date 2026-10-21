import { asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@life-tracker/db";
import { tcgArtwork, tcgCard, tcgPrinting } from "@life-tracker/db/schema/index";

import type { transformCatalog } from "./catalog-transform";
import type { ArtistUpdate } from "./limitless";

/** Rows per insert, well under Postgres' 65535 bind-parameter limit. */
const CHUNK = 1000;

const chunks = <T>(rows: T[]) =>
  Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));

/**
 * Idempotent catalog upsert, keyed by card number, variant ID and
 * (variant ID, language). Only writes catalog columns: an Artwork's artist,
 * artist-conflict flag and a manga kind from Limitless (KOI-306), and every
 * per-user table, are left alone, and nothing is deleted.
 */
export async function upsertCatalog(catalog: ReturnType<typeof transformCatalog>): Promise<void> {
  await db.transaction(async (tx) => {
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
            variantKind: sql`case when ${tcgArtwork.variantKind} = 'manga' then ${tcgArtwork.variantKind} else excluded.variant_kind end`,
          },
        });
    }
    for (const rows of chunks(catalog.printings)) {
      await tx
        .insert(tcgPrinting)
        .values(rows)
        .onConflictDoUpdate({
          target: [tcgPrinting.variantId, tcgPrinting.language],
          set: {
            packId: sql`excluded.pack_id`,
            setName: sql`excluded.set_name`,
            imageUrl: sql`excluded.image_url`,
          },
        });
    }
  });
}

/**
 * Artworks grouped by Card, optionally only Cards with a Printing in one set
 * (`OP-05`), each with one Printing's Bandai image to compare art against: the
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
          .where(eq(tcgPrinting.setName, set)),
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
