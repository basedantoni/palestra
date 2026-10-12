import { boolean, date, index, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { tcgConditionEnum, tcgLanguageEnum, tcgVariantKindEnum } from "./enums";

/**
 * One Piece TCG catalog (KOI-304): global reference data imported from
 * punk-records by `pnpm db:import:tcg` (ADR 0006). Not per user. Terms follow the
 * TCG sections of packages/api/GLOSSARY.md.
 */

/** A card number (e.g. `OP05-069`) and its character. */
export const tcgCard = pgTable("tcg_card", {
  number: text("number").primaryKey(),
  nameEn: text("name_en"),
  nameJa: text("name_ja"),
});

/** One illustration of a Card, keyed by Bandai's variant ID (e.g. `OP05-069_p1`). */
export const tcgArtwork = pgTable(
  "tcg_artwork",
  {
    variantId: text("variant_id").primaryKey(),
    cardNumber: text("card_number")
      .notNull()
      .references(() => tcgCard.number, { onDelete: "cascade" }),
    variantKind: tcgVariantKindEnum("variant_kind").notNull(),
    /** Null = uncredited / not yet backfilled (KOI-306). The import never writes it. */
    artist: text("artist"),
    /** Japanese and English sources disagree on the artist (KOI-306). */
    artistConflict: boolean("artist_conflict").default(false).notNull(),
  },
  (table) => [index("tcg_artwork_cardNumber_idx").on(table.cardNumber)],
);

/** An Artwork released in one language, with its set and hotlinked Bandai image. */
export const tcgPrinting = pgTable(
  "tcg_printing",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: text("variant_id")
      .notNull()
      .references(() => tcgArtwork.variantId, { onDelete: "cascade" }),
    language: tcgLanguageEnum("language").notNull(),
    /** punk-records pack id (e.g. `550105`). */
    packId: text("pack_id").notNull(),
    /** Set code (`OP-05`) or product title. */
    setName: text("set_name").notNull(),
    imageUrl: text("image_url").notNull(),
  },
  (table) => [uniqueIndex("tcg_printing_variantId_language_unique_idx").on(table.variantId, table.language)],
);

/**
 * One physical card the user holds (KOI-309). Per user. The optional Want link is
 * added with the buying flow (KOI-311).
 */
export const tcgCopy = pgTable(
  "tcg_copy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // No cascade: a catalog change must never delete what the user owns.
    printingId: uuid("printing_id")
      .notNull()
      .references(() => tcgPrinting.id),
    condition: tcgConditionEnum("condition").notNull(),
    /** USD dollars, like finance amounts. Null for gifts and pack pulls. */
    pricePaid: real("price_paid"),
    acquiredOn: date("acquired_on", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("tcg_copy_userId_idx").on(table.userId)],
);
