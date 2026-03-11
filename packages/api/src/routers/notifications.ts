import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@src/db";
import { notification } from "@src/db/schema/notification";

import { protectedProcedure, router } from "../index";

export const notificationsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      return db
        .select()
        .from(notification)
        .where(eq(notification.userId, ctx.session.user.id))
        .orderBy(desc(notification.createdAt))
        .limit(limit);
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notification)
      .where(
        and(
          eq(notification.userId, ctx.session.user.id),
          isNull(notification.readAt),
        ),
      );
    return result?.count ?? 0;
  }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(notification)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notification.id, input.id),
            eq(notification.userId, ctx.session.user.id),
          ),
        )
        .returning();
      return updated ?? null;
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notification.userId, ctx.session.user.id),
          isNull(notification.readAt),
        ),
      );
    return { success: true };
  }),
});
