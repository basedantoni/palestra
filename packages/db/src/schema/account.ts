import { relations, sql } from "drizzle-orm";
import { check, index, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { accountSourceEnum, accountTypeEnum } from "./enums";
import { user } from "./auth";
import { plaidItem } from "./plaid-item";

/**
 * A financial account surfaced by Plaid (checking, savings, credit card, ...)
 * or by SnapTrade (Fidelity 401k / brokerage, KOI-318).
 *
 * `source` decides which identity columns are set: Plaid rows carry the Plaid
 * item + account id, SnapTrade rows carry `snaptradeAccountId` and store their
 * own `institutionName` (no Plaid item behind them). A CHECK enforces it.
 *
 * Named `financialAccount` to avoid colliding with Better-Auth's `account`
 * table (OAuth provider accounts).
 *
 * `type` carries the full enum (depository/credit/investment/loan); only
 * depository/credit are expected in v1 (Transactions product), the rest are
 * reserved for a future net-worth / investments slice.
 *
 * Balances are point-in-time as of the last sync; historical balances live in
 * `balance_snapshot`.
 */
export const financialAccount = pgTable(
  "financial_account",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: accountSourceEnum("source").default("plaid").notNull(),
    plaidItemId: uuid("plaid_item_id").references(() => plaidItem.id, { onDelete: "cascade" }),
    plaidAccountId: text("plaid_account_id"),
    snaptradeAccountId: text("snaptrade_account_id"),
    /** Set for SnapTrade accounts; Plaid accounts read theirs from the Plaid item. */
    institutionName: text("institution_name"),
    name: text("name").notNull(),
    officialName: text("official_name"),
    mask: text("mask"),
    type: accountTypeEnum("type").notNull(),
    subtype: text("subtype"),
    currentBalance: real("current_balance"),
    availableBalance: real("available_balance"),
    isoCurrencyCode: text("iso_currency_code"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("financial_account_userId_idx").on(table.userId),
    index("financial_account_plaidItemId_idx").on(table.plaidItemId),
    uniqueIndex("financial_account_plaidAccountId_unique_idx").on(table.plaidAccountId),
    uniqueIndex("financial_account_snaptradeAccountId_unique_idx").on(table.snaptradeAccountId),
    check(
      "financial_account_source_identity",
      sql`(${table.source} = 'plaid' and ${table.plaidItemId} is not null and ${table.plaidAccountId} is not null and ${table.snaptradeAccountId} is null)
        or (${table.source} = 'snaptrade' and ${table.snaptradeAccountId} is not null and ${table.plaidItemId} is null and ${table.plaidAccountId} is null)`,
    ),
  ],
);

export const financialAccountRelations = relations(financialAccount, ({ one }) => ({
  user: one(user, {
    fields: [financialAccount.userId],
    references: [user.id],
  }),
  plaidItem: one(plaidItem, {
    fields: [financialAccount.plaidItemId],
    references: [plaidItem.id],
  }),
}));
