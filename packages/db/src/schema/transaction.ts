import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { transactionFlowEnum } from "./enums";
import { user } from "./auth";
import { financialAccount } from "./account";
import { category } from "./category";

/**
 * A Plaid transaction.
 *
 * Columns are introduced for the full v1 feature set even though slices
 * populate them progressively: `flow` (slice 3 classification), `categoryId`
 * (slice 4 — FK to a category table added then), `transferPairId` (slice 3
 * internal-transfer matching). Raw `plaidCategory*` is always retained.
 *
 * `amount` follows Plaid's sign convention (positive = money out of the
 * account). Budget spend is computed on read over `flow='expense'`, not
 * `excluded` rows.
 */
export const transaction = pgTable(
  "transaction",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => financialAccount.id, { onDelete: "cascade" }),
    /** Null on a Split, which no bank reported (ADR 0007). */
    plaidTransactionId: text("plaid_transaction_id"),
    amount: real("amount").notNull(),
    date: timestamp("date").notNull(),
    name: text("name").notNull(),
    merchantName: text("merchant_name"),
    pending: boolean("pending").default(false).notNull(),
    flow: transactionFlowEnum("flow"),
    /** User corrected `flow`; Plaid sync leaves it alone (ADR 0001). */
    flowOverridden: boolean("flow_overridden").default(false).notNull(),
    plaidCategoryPrimary: text("plaid_category_primary"),
    plaidCategoryDetailed: text("plaid_category_detailed"),
    categoryId: uuid("category_id").references(() => category.id, {
      onDelete: "set null",
    }),
    /** Manual Category: user picked it by hand; rules and sync leave it alone (ADR 0004). */
    categoryOverridden: boolean("category_overridden").default(false).notNull(),
    excluded: boolean("excluded").default(false).notNull(),
    note: text("note"),
    /** False = Unreviewed: a posted row the user hasn't confirmed or edited by hand (KOI-342). Pending rows arrive reviewed. */
    reviewed: boolean("reviewed").default(false).notNull(),
    transferPairId: uuid("transfer_pair_id"),
    /** Set on a Split: the transaction it is a piece of (ADR 0007). Deleting the parent deletes its Splits. */
    parentTransactionId: uuid("parent_transaction_id").references((): AnyPgColumn => transaction.id, {
      onDelete: "cascade",
    }),
    isoCurrencyCode: text("iso_currency_code"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("transaction_userId_idx").on(table.userId),
    index("transaction_accountId_idx").on(table.accountId),
    uniqueIndex("transaction_plaidTransactionId_unique_idx").on(table.plaidTransactionId),
    index("transaction_userId_date_idx").on(table.userId, table.date),
    index("transaction_parentTransactionId_idx").on(table.parentTransactionId),
    // Supports compute-on-read budget spend (slice 5).
    index("transaction_budget_idx").on(
      table.userId,
      table.categoryId,
      table.date,
      table.flow,
    ),
  ],
);

export const transactionRelations = relations(transaction, ({ one }) => ({
  user: one(user, {
    fields: [transaction.userId],
    references: [user.id],
  }),
  account: one(financialAccount, {
    fields: [transaction.accountId],
    references: [financialAccount.id],
  }),
}));

/**
 * Daily point-in-time balance per account, written on each sync (upsert
 * latest-of-day). Powers goal projection and net-worth trend; Plaid only
 * reports current balance, so history must be captured going forward.
 */
export const balanceSnapshot = pgTable(
  "balance_snapshot",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => financialAccount.id, { onDelete: "cascade" }),
    asOfDate: date("as_of_date").notNull(),
    balance: real("balance").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("balance_snapshot_userId_idx").on(table.userId),
    uniqueIndex("balance_snapshot_account_date_unique_idx").on(
      table.accountId,
      table.asOfDate,
    ),
  ],
);

export const balanceSnapshotRelations = relations(balanceSnapshot, ({ one }) => ({
  account: one(financialAccount, {
    fields: [balanceSnapshot.accountId],
    references: [financialAccount.id],
  }),
}));
