/**
 * whoopSleepRouter — Phase 7
 *
 * tRPC procedures for querying imported Whoop sleep sessions.
 */

import { and, desc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { whoopSleep } from "@life-tracker/db/schema/index";

import { protectedProcedure, router } from "../index";
import { resolveAnalyticsDateBounds } from "../lib/analytics-bounds";

const DEFAULT_WHOOP_LIST_LIMIT = 25;
const MAX_WHOOP_LIST_LIMIT = 5000;

export const whoopSleepRouter = router({
  /**
   * Paginated list of sleep sessions for the authenticated user.
   * Ordered by start DESC. Supports optional date-range filtering.
   * Cursor is the ISO string of the last item's start timestamp.
   */
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(MAX_WHOOP_LIST_LIMIT).optional(),
        cursor: z.string().optional(), // ISO datetime — start of last fetched row
        from: z.string().optional(), // ISO date/datetime string (inclusive)
        to: z.string().optional(), // ISO date/datetime string (inclusive)
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const bounds = resolveAnalyticsDateBounds(input);
      const hasRangeBounds = bounds.from != null || bounds.to != null;
      const limit =
        input.limit ??
        (hasRangeBounds ? MAX_WHOOP_LIST_LIMIT : DEFAULT_WHOOP_LIST_LIMIT);
      // Fetch one extra row to determine whether a next page exists
      const fetchLimit = limit + 1;

      const conditions = [eq(whoopSleep.userId, userId)];

      if (bounds.from) {
        conditions.push(sql`${whoopSleep.start}::date >= ${bounds.from}::date`);
      }
      if (bounds.to) {
        conditions.push(sql`${whoopSleep.start}::date <= ${bounds.to}::date`);
      }
      if (input.cursor) {
        conditions.push(lte(whoopSleep.start, new Date(input.cursor)));
      }

      const rows = await db
        .select()
        .from(whoopSleep)
        .where(and(...conditions))
        .orderBy(desc(whoopSleep.start))
        .limit(fetchLimit);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore
        ? items[items.length - 1]!.start.toISOString()
        : null;

      return { items, nextCursor };
    }),

  /**
   * Returns a single sleep session by its DB row id.
   * Returns null if not found or not owned by the authenticated user.
   */
  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const [row] = await db
        .select()
        .from(whoopSleep)
        .where(and(eq(whoopSleep.id, input.id), eq(whoopSleep.userId, userId)));

      return row ?? null;
    }),
});
