import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { category } from "./category";
import { tcgConditionEnum, tcgLanguageEnum, tcgVariantKindEnum, tcgWantStatusEnum } from "./enums";

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
    /** punk-records rarity (`SecretRare`, `Special`), for the matcher's TypeSafe tier. Null until the next import. */
    rarity: text("rarity"),
    /** Null = uncredited / not yet backfilled (KOI-306). The import never writes it. */
    artist: text("artist"),
    /** Japanese and English sources disagree on the artist (KOI-306). */
    artistConflict: boolean("artist_conflict").default(false).notNull(),
  },
  (table) => [index("tcg_artwork_cardNumber_idx").on(table.cardNumber)],
);

/**
 * An Artwork released in one language, with its set and hotlinked Bandai image.
 * Identified by its language's own list ID: an English Printing is paired to its
 * Japanese Artwork by pack and image, so its variant ID can differ (KOI-332).
 */
export const tcgPrinting = pgTable(
  "tcg_printing",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: text("variant_id")
      .notNull()
      .references(() => tcgArtwork.variantId, { onDelete: "cascade" }),
    language: tcgLanguageEnum("language").notNull(),
    /** Bandai's ID in this language's card list (e.g. English `OP05-119_p4` is Japanese `OP05-119_p3`). */
    listId: text("list_id"),
    /** punk-records pack id (e.g. `550105`). */
    packId: text("pack_id").notNull(),
    /** Set code (`OP-05`) or product title. */
    setName: text("set_name").notNull(),
    imageUrl: text("image_url").notNull(),
  },
  // One Printing per Artwork per language is the pairing's job, not a constraint:
  // re-pairing swaps English Printings between Artworks with plain UPDATEs.
  (table) => [
    uniqueIndex("tcg_printing_language_listId_unique_idx").on(table.language, table.listId),
    index("tcg_printing_variantId_idx").on(table.variantId),
  ],
);

/**
 * The user's intent to acquire one Copy of an Artwork (KOI-308). Several Wants
 * may target the same Artwork. open <-> dropped; the buying flow (KOI-311) moves
 * open -> ordered (an Offer bought) -> fulfilled (a Copy received), or ordered ->
 * open (order cancelled). Fulfilled is terminal.
 */
export const tcgWant = pgTable(
  "tcg_want",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => tcgArtwork.variantId),
    /** Accepted languages: one or both. */
    languages: tcgLanguageEnum("languages").array().notNull(),
    /** Maximum delivered price, USD dollars. */
    maxPrice: real("max_price").notNull(),
    minCondition: tcgConditionEnum("min_condition").notNull(),
    status: tcgWantStatusEnum("status").default("open").notNull(),
    /** The Offer taken, set exactly while ordered or fulfilled. No cascade: a bought Offer can't be deleted. */
    boughtOfferId: uuid("bought_offer_id").references((): AnyPgColumn => tcgOffer.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("tcg_want_userId_status_idx").on(table.userId, table.status),
    check(
      "tcg_want_bought_offer_while_ordered",
      sql`(${table.status} in ('ordered', 'fulfilled')) = (${table.boughtOfferId} is not null)`,
    ),
  ],
);

/** The user's 0–5 Art Rating of an Artwork, shared by all its Printings (KOI-307). No row = unrated. */
export const tcgArtRating = pgTable(
  "tcg_art_rating",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => tcgArtwork.variantId, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.variantId] }),
    check("tcg_art_rating_range", sql`${table.rating} between 0 and 5`),
  ],
);

/** A user-defined tag grouping Artworks (e.g. D Clan). Names unique per user, ignoring case (KOI-307). */
export const tcgTheme = pgTable(
  "tcg_theme",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("tcg_theme_userId_name_unique_idx").on(table.userId, sql`lower(${table.name})`)],
);

/** An Artwork tagged with a Theme. Owned through the Theme; deleting the Theme removes its tags. */
export const tcgArtworkTheme = pgTable(
  "tcg_artwork_theme",
  {
    themeId: uuid("theme_id")
      .notNull()
      .references(() => tcgTheme.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => tcgArtwork.variantId, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.themeId, table.variantId] }),
    index("tcg_artwork_theme_variantId_idx").on(table.variantId),
  ],
);

/**
 * One physical card the user holds (KOI-309). Per user. Linked to the Want it
 * fulfilled when received through the buying flow (KOI-311).
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
    /** The Want this Copy fulfilled; null when added directly. */
    wantId: uuid("want_id").references((): AnyPgColumn => tcgWant.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("tcg_copy_userId_idx").on(table.userId)],
);

/**
 * A seller's delivered price for one Printing, seen on a date, recorded against
 * a Want (KOI-310). Per user through its Want. The Printing must be of the
 * Want's Artwork and in one of its accepted languages (checked by the router).
 */
export const tcgOffer = pgTable(
  "tcg_offer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wantId: uuid("want_id")
      .notNull()
      .references(() => tcgWant.id, { onDelete: "cascade" }),
    printingId: uuid("printing_id")
      .notNull()
      .references(() => tcgPrinting.id),
    /** Free text: a shop, Mercari, a local store. */
    seller: text("seller").notNull(),
    /** Delivered price (item + shipping + tax), USD dollars; yen converted by hand. */
    price: real("price").notNull(),
    url: text("url"),
    seenOn: date("seen_on").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("tcg_offer_wantId_idx").on(table.wantId)],
);

/**
 * Per-user TCG settings (KOI-312): which finance category counts as Cards and
 * the Card Fund's start month (ADR 0005). Deleting the category unsets it.
 */
export const tcgSettings = pgTable("tcg_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  cardsCategoryId: uuid("cards_category_id").references(() => category.id, { onDelete: "set null" }),
  /** YYYY-MM, inclusive. */
  startMonth: text("start_month").notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});
