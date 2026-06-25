import { relations } from "drizzle-orm";
import { index, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { category } from "./category";

/**
 * Copilot-style monthly category budget. `monthKey` is "YYYY-MM" in the user's
 * timezone; calendar month, no rollover. Spend is computed on read
 * (`budget-spend.ts`), so this table holds only the limit.
 */
export const budget = pgTable(
  "budget",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "cascade" }),
    monthKey: text("month_key").notNull(),
    limitAmount: real("limit_amount").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("budget_userId_idx").on(table.userId),
    uniqueIndex("budget_userId_category_month_unique_idx").on(
      table.userId,
      table.categoryId,
      table.monthKey,
    ),
  ],
);

export const budgetRelations = relations(budget, ({ one }) => ({
  user: one(user, { fields: [budget.userId], references: [user.id] }),
  category: one(category, {
    fields: [budget.categoryId],
    references: [category.id],
  }),
}));
