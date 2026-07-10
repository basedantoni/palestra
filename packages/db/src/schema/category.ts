import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * User-owned spending category. Seeded from Plaid PFC on first connect
 * (`category-seed.ts`), and freely extendable by the user. `isSystem` marks the
 * seeded rows so the UI can distinguish them from custom ones.
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
