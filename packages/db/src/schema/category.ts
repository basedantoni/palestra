import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { ruleMatchModeEnum, transactionFlowEnum } from "./enums";

/**
 * User-owned spending category. Seeded from the Bank Categories on first connect
 * (`category-seed.ts`), and freely extendable, renamable and deletable by the
 * user. `isSystem` only records which rows were seeded. `color` is a palette
 * token (`CATEGORY_COLORS` in @life-tracker/shared), checked by the router, not
 * an enum, so the palette can change without a migration; null renders neutral.
 * `icon` is likewise a lucide icon name from `CATEGORY_ICONS`.
 * Lists order by `sortOrder`, then name.
 *
 * `parentId` files a Subcategory under a Parent Category (KOI-337). The tree is
 * two levels deep, enforced by `categories.update`, not the database; a
 * Subcategory stores no color (it renders as a tint of its parent's).
 *
 * `excluded` makes it an Excluded Category (KOI-338): its transactions, and its
 * Subcategories', leave every total (`countsInTotals`) but stay in the ledger.
 */
export const category = pgTable(
  "category",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => category.id, { onDelete: "set null" }),
    isSystem: boolean("is_system").default(false).notNull(),
    color: text("color"),
    icon: text("icon"),
    excluded: boolean("excluded").default(false).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("category_userId_idx").on(table.userId),
    index("category_parentId_idx").on(table.parentId),
    uniqueIndex("category_userId_name_unique_idx").on(table.userId, table.name),
  ],
);

export const categoryRelations = relations(category, ({ one }) => ({
  user: one(user, {
    fields: [category.userId],
    references: [user.id],
  }),
}));

/**
 * Bank Category mapping (KOI-335): which category a Bank Category gives a
 * transaction as its Default Category. Held by id, so renaming a category keeps
 * it; deleting the category leaves the Bank Category unmapped (null), and its
 * transactions are Uncategorized from their next resolve. A user with no rows
 * gets them on first read (`loadBankCategoryMapping`), mapped by name to their
 * categories (`category-seed.ts`).
 */
export const bankCategoryMapping = pgTable(
  "bank_category_mapping",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pfcPrimary: text("pfc_primary").notNull(),
    categoryId: uuid("category_id").references(() => category.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.pfcPrimary] })],
);

/**
 * Rule (KOI-298, KOI-339, KOI-340): transactions whose bank description
 * matches `pattern` get `categoryId`, `setFlow`, or both; each resolves on its
 * own. An income or transfer rule sets no category. `matchMode` is `exact`
 * (the whole trimmed description) or `contains`; both ignore case and accents.
 * Matching lives in TypeScript (`rules.ts`), never SQL. `patternKey` is the
 * folded pattern (`fold`), so the same Pattern exists once per mode. Deleting
 * the category deletes its rules.
 */
export const rule = pgTable(
  "rule",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pattern: text("pattern").notNull(),
    patternKey: text("pattern_key").notNull(),
    matchMode: ruleMatchModeEnum("match_mode").default("contains").notNull(),
    categoryId: uuid("category_id").references(() => category.id, { onDelete: "cascade" }),
    setFlow: transactionFlowEnum("set_flow"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("rule_userId_matchMode_patternKey_unique_idx").on(table.userId, table.matchMode, table.patternKey),
    check("rule_sets_something", sql`${table.categoryId} is not null or ${table.setFlow} is not null`),
    check("rule_no_category_off_expense", sql`${table.categoryId} is null or ${table.setFlow} is null or ${table.setFlow} = 'expense'`),
  ],
);

export const ruleRelations = relations(rule, ({ one }) => ({
  user: one(user, {
    fields: [rule.userId],
    references: [user.id],
  }),
  category: one(category, {
    fields: [rule.categoryId],
    references: [category.id],
  }),
}));
