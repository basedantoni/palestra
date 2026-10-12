import { sql } from "drizzle-orm";

import { db } from "@life-tracker/db";
import { tcgArtwork, tcgCard, tcgPrinting } from "@life-tracker/db/schema/index";

import type { transformCatalog } from "./catalog-transform";

/** Rows per insert, well under Postgres' 65535 bind-parameter limit. */
const CHUNK = 1000;

const chunks = <T>(rows: T[]) =>
  Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));

/**
 * Idempotent catalog upsert, keyed by card number, variant ID and
 * (variant ID, language). Only writes catalog columns: an Artwork's artist and
 * artist-conflict flag (KOI-306) and every per-user table are left alone, and
 * nothing is deleted.
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
          set: { cardNumber: sql`excluded.card_number`, variantKind: sql`excluded.variant_kind` },
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
