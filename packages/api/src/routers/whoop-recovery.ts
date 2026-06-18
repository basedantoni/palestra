/**
 * whoopRecoveryRouter — Phase 8
 *
 * tRPC procedures for querying imported Whoop recovery sessions.
 */

import { and, desc, eq, lte } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { whoopRecovery } from "@life-tracker/db/schema/index";

import { protectedProcedure, router } from "../index";

export const whoopRecoveryRouter = router({
  /**
   * Paginated list of recovery sessions for the authenticated user.
   * Ordered by createdAt DESC.
   * Cursor is the ISO string of the last item's createdAt timestamp.
   */
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(25),
        cursor: z.string().optional(), // ISO datetime — createdAt of last fetched row
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const limit = input.limit;
      // Fetch one extra row to determine whether a next page exists
      const fetchLimit = limit + 1;

      const conditions = [eq(whoopRecovery.userId, userId)];

      if (input.cursor) {
        conditions.push(lte(whoopRecovery.createdAt, new Date(input.cursor)));
      }

      const rows = await db
        .select()
        .from(whoopRecovery)
        .where(and(...conditions))
        .orderBy(desc(whoopRecovery.createdAt))
        .limit(fetchLimit);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore
        ? items[items.length - 1]!.createdAt.toISOString()
        : null;

      return { items, nextCursor };
    }),

  /**
   * Returns the most recent recovery session for the authenticated user.
   * Returns null if no recovery data exists.
   */
  latest: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [row] = await db
      .select()
      .from(whoopRecovery)
      .where(eq(whoopRecovery.userId, userId))
      .orderBy(desc(whoopRecovery.createdAt))
      .limit(1);

    return row ?? null;
  }),
});
