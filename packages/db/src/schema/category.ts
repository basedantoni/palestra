import { relations, sql } from "drizzle-orm";
import { boolean, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * User-owned spending category. Seeded from Plaid PFC on first connect
 * (`category-seed.ts`), and freely extendable, renamable and deletable by the
 * user. `isSystem` only records which rows were seeded.
 */
export const category = pgTable(
  "category",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isSystem: boolean("is_system").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("category_userId_idx").on(table.userId),
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
 * Bank Category mapping (KOI-335): which category a Plaid PFC primary gives a
 * transaction as its Default Category. Held by id, so renaming a category keeps
 * it; deleting the category leaves the Bank Category unmapped (null), and its
 * transactions are Uncategorized from their next resolve. Seeded with the
 * user's categories (`category-seed.ts`); a row's existence marks the user as
 * seeded.
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
 * Category Rule (KOI-298): transactions whose bank description contains
 * `pattern` (ignoring case) get `categoryId`. Matching lives in TypeScript
 * (`category-rules.ts`), never SQL. Deleting the category deletes its rules.
 */
export const categoryRule = pgTable(
  "category_rule",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pattern: text("pattern").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("category_rule_userId_pattern_unique_idx").on(table.userId, sql`lower(${table.pattern})`),
  ],
);

export const categoryRuleRelations = relations(categoryRule, ({ one }) => ({
  user: one(user, {
    fields: [categoryRule.userId],
    references: [user.id],
  }),
  category: one(category, {
    fields: [categoryRule.categoryId],
    references: [category.id],
  }),
}));
