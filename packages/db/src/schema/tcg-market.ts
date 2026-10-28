import { date, integer, pgTable, primaryKey, real, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { tcgConditionEnum, tcgMarketplaceEnum, tcgMatchMethodEnum } from "./enums";
import { tcgArtwork, tcgPrinting } from "./tcg";

/**
 * Market Watch (KOI-366, ADR 0007): Marketplace Products and their daily Market Prices. Currency is
 * a code constant per Marketplace, not a column. Terms follow the TCG market section of
 * packages/api/GLOSSARY.md.
 */

/**
 * A Marketplace's own product (a TCGplayer product, a CardTrader blueprint) and the Artwork it is
 * of: the mapping store and the unmatched list. Unmatched = no `variant_id` and a method other than
 * `manual`; a manual row with no `variant_id` means "not an Artwork". The matcher never touches
 * manual rows.
 */
export const tcgMarketplaceProduct = pgTable(
  "tcg_marketplace_product",
  {
    id: serial("id").primaryKey(),
    marketplace: tcgMarketplaceEnum("marketplace").notNull(),
    /** The Marketplace's id for it (TCGplayer `productId`). */
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    /** Card number as the Marketplace prints it (e.g. `OP05-119`). */
    number: text("number").notNull(),
    /** The Marketplace's set (TCGCSV group abbreviation, e.g. `OP05`). */
    set: text("set").notNull(),
    // Cascade, not set null: a null would turn a manual match into "not an Artwork". The product is
    // seen again as new at the next capture; its prices went with the Artwork's Printings.
    variantId: text("variant_id").references(() => tcgArtwork.variantId, { onDelete: "cascade" }),
    method: tcgMatchMethodEnum("method").notNull(),
    /** 0–1, for matches from a tier that scores them; null otherwise. */
    confidence: real("confidence"),
    /** Why the product is unmatched. */
    reason: text("reason"),
    matchedAt: timestamp("matched_at"),
    lastSeenOn: date("last_seen_on", { mode: "string" }).notNull(),
  },
  (table) => [uniqueIndex("tcg_marketplace_product_marketplace_externalId_unique_idx").on(table.marketplace, table.externalId)],
);

/**
 * One Marketplace's price for one Printing in one Condition on one UTC day, in the Marketplace's
 * currency. No row = no price that day. No secondary indexes: every read is a range scan on the key.
 */
export const tcgMarketPrice = pgTable(
  "tcg_market_price",
  {
    printingId: uuid("printing_id")
      .notNull()
      .references(() => tcgPrinting.id, { onDelete: "cascade" }),
    marketplace: tcgMarketplaceEnum("marketplace").notNull(),
    condition: tcgConditionEnum("condition").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    /** Major units, native currency. */
    price: real("price").notNull(),
    /** Listings the lowest ask was drawn from; null for TCGplayer's aggregate. */
    listingCount: integer("listing_count"),
    /** The product that supplied the price. */
    marketplaceProductId: integer("marketplace_product_id")
      .notNull()
      .references(() => tcgMarketplaceProduct.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.printingId, table.marketplace, table.condition, table.day] })],
);
