import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { category } from "@life-tracker/db/schema/index";

import { protectedProcedure, router } from "../index";

export const categoriesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select()
      .from(category)
      .where(eq(category.userId, ctx.session.user.id))
      .orderBy(category.name);
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(60) }))
    .mutation(async ({ ctx, input }) => {
      const id = randomUUID();
      await db
        .insert(category)
        .values({ id, userId: ctx.session.user.id, name: input.name, isSystem: false })
        .onConflictDoNothing();
      return { id };
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.string().uuid(), name: z.string().min(1).max(60) }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(category)
        .set({ name: input.name })
        .where(and(eq(category.id, input.id), eq(category.userId, ctx.session.user.id)));
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(category)
        .where(and(eq(category.id, input.id), eq(category.userId, ctx.session.user.id)));
      return { ok: true };
    }),
});
