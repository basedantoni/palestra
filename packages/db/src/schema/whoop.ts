import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const whoopConnection = pgTable(
  "whoop_connection",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    tokenExpiresAt: timestamp("token_expires_at").notNull(),
    connectedAt: timestamp("connected_at").defaultNow().notNull(),
    lastImportedAt: timestamp("last_imported_at"),
    isValid: boolean("is_valid").default(true).notNull(),
  },
  (table) => [
    unique("whoop_connection_userId_unique").on(table.userId),
    index("whoop_connection_userId_idx").on(table.userId),
  ],
);

export const whoopConnectionRelations = relations(whoopConnection, ({ one }) => ({
  user: one(user, {
    fields: [whoopConnection.userId],
    references: [user.id],
  }),
}));
