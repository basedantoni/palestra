import { relations } from "drizzle-orm";
import { index, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { accountTypeEnum } from "./enums";
import { user } from "./auth";
import { plaidItem } from "./plaid-item";

/**
 * A financial account surfaced by Plaid (checking, savings, credit card, ...).
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
    plaidItemId: uuid("plaid_item_id")
      .notNull()
      .references(() => plaidItem.id, { onDelete: "cascade" }),
    plaidAccountId: text("plaid_account_id").notNull(),
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
