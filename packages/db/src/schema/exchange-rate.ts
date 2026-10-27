import { char, date, doublePrecision, pgTable, primaryKey } from "drizzle-orm/pg-core";

/**
 * ECB euro reference rates (KOI-364): units of `currency` per 1 EUR on an ECB publish day. No
 * `tcg_` prefix, since finance may reuse it. Days without a publication have no rows; a reader
 * takes the latest rate on or before its day.
 */
export const exchangeRate = pgTable(
  "exchange_rate",
  {
    day: date("day", { mode: "string" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    perEur: doublePrecision("per_eur").notNull(),
  },
  (table) => [primaryKey({ columns: [table.currency, table.day] })],
);
