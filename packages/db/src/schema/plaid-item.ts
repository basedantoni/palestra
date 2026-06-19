import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * A linked Plaid Item — one row per connected institution.
 *
 * The Plaid `access_token` is stored encrypted at rest (`accessTokenEnc`) via
 * the same `token-encryption.ts` mechanism used for Whoop OAuth tokens; raw
 * tokens are never logged or persisted.
 *
 * `transactionCursor` is the `/transactions/sync` cursor, advanced only on a
 * successful drain. `status` mirrors Plaid Item health ("active",
 * "login_required", "pending_expiration", "error") so the UI can surface a
 * reconnect prompt on ITEM_LOGIN_REQUIRED.
 */
export const plaidItem = pgTable(
  "plaid_item",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    institutionId: text("institution_id"),
    institutionName: text("institution_name"),
    accessTokenEnc: text("access_token_enc").notNull(),
    transactionCursor: text("transaction_cursor"),
    status: text("status").default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("plaid_item_userId_idx").on(table.userId),
    uniqueIndex("plaid_item_itemId_unique_idx").on(table.itemId),
  ],
);

export const plaidItemRelations = relations(plaidItem, ({ one }) => ({
  user: one(user, {
    fields: [plaidItem.userId],
    references: [user.id],
  }),
}));
