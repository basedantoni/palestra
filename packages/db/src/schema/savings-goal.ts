import { relations } from "drizzle-orm";
import { date, index, pgTable, primaryKey, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { financialAccount } from "./account";

/**
 * Balance-driven savings goal. Progress = live balance of the linked
 * account(s); on-track / projected completion is derived from balance
 * snapshots (`goal-projection.ts`). No manual allocation.
 */
export const savingsGoal = pgTable(
  "savings_goal",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    targetAmount: real("target_amount").notNull(),
    targetDate: date("target_date"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("savings_goal_userId_idx").on(table.userId)],
);

/** Join: a goal is funded by one or more dedicated accounts. */
export const savingsGoalAccount = pgTable(
  "savings_goal_account",
  {
    goalId: uuid("goal_id")
      .notNull()
      .references(() => savingsGoal.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => financialAccount.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.goalId, table.accountId] })],
);

export const savingsGoalRelations = relations(savingsGoal, ({ one, many }) => ({
  user: one(user, { fields: [savingsGoal.userId], references: [user.id] }),
  accounts: many(savingsGoalAccount),
}));

export const savingsGoalAccountRelations = relations(savingsGoalAccount, ({ one }) => ({
  goal: one(savingsGoal, {
    fields: [savingsGoalAccount.goalId],
    references: [savingsGoal.id],
  }),
  account: one(financialAccount, {
    fields: [savingsGoalAccount.accountId],
    references: [financialAccount.id],
  }),
}));
