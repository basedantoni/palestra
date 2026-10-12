import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { tcgArtwork, tcgCard, tcgConditionEnum, tcgCopy, tcgPrinting, tcgWant } from "@life-tracker/db/schema/index";

import { protectedProcedure, router } from "../index";
import { isBelowCondition } from "../lib/tcg-condition";

async function assertPrintingExists(printingId: string) {
  const [found] = await db.select({ id: tcgPrinting.id }).from(tcgPrinting).where(eq(tcgPrinting.id, printingId)).limit(1);
  if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "Printing not found" });
}

/** Copies the user holds (KOI-309). Mounted as `tcg.copies`. */
export const tcgCopiesRouter = router({
  /** Add a Copy directly, without a Want: cards already owned, gifts, pack pulls. */
  create: protectedProcedure
    .input(
      z.object({
        printingId: z.uuid(),
        condition: z.enum(tcgConditionEnum.enumValues),
        pricePaid: z.number().nonnegative().nullish(),
        acquiredOn: z.iso.date(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPrintingExists(input.printingId);
      const [created] = await db
        .insert(tcgCopy)
        .values({ userId: ctx.session.user.id, ...input })
        .returning({ id: tcgCopy.id });
      return created;
    }),

  /** Edit a Copy; omitted fields stay as they are. A wrong Printing is fixed by delete + re-add. */
  update: protectedProcedure
    .input(
      z.object({
        id: z.uuid(),
        condition: z.enum(tcgConditionEnum.enumValues).optional(),
        pricePaid: z.number().nonnegative().nullable().optional(),
        acquiredOn: z.iso.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input: { id, ...set } }) => {
      if (Object.values(set).every((v) => v === undefined)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to update" });
      }
      const [updated] = await db
        .update(tcgCopy)
        .set(set)
        .where(and(eq(tcgCopy.id, id), eq(tcgCopy.userId, ctx.session.user.id)))
        .returning({ id: tcgCopy.id });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Copy not found" });
      return updated;
    }),

  /** Remove a Copy, e.g. sold or traded away. */
  delete: protectedProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    const [deleted] = await db
      .delete(tcgCopy)
      .where(and(eq(tcgCopy.id, input.id), eq(tcgCopy.userId, ctx.session.user.id)))
      .returning({ id: tcgCopy.id });
    if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Copy not found" });
    return deleted;
  }),

  /**
   * The caller's Copies with their Printing and character, newest first.
   * `belowMinimum`: received through a Want in a Condition worse than its minimum.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        id: tcgCopy.id,
        printingId: tcgCopy.printingId,
        variantId: tcgPrinting.variantId,
        language: tcgPrinting.language,
        setName: tcgPrinting.setName,
        imageUrl: tcgPrinting.imageUrl,
        nameEn: tcgCard.nameEn,
        nameJa: tcgCard.nameJa,
        condition: tcgCopy.condition,
        pricePaid: tcgCopy.pricePaid,
        acquiredOn: tcgCopy.acquiredOn,
        minCondition: tcgWant.minCondition,
      })
      .from(tcgCopy)
      .innerJoin(tcgPrinting, eq(tcgPrinting.id, tcgCopy.printingId))
      .innerJoin(tcgArtwork, eq(tcgArtwork.variantId, tcgPrinting.variantId))
      .innerJoin(tcgCard, eq(tcgCard.number, tcgArtwork.cardNumber))
      .leftJoin(tcgWant, eq(tcgWant.id, tcgCopy.wantId))
      .where(eq(tcgCopy.userId, ctx.session.user.id))
      .orderBy(desc(tcgCopy.acquiredOn), desc(tcgCopy.createdAt));
    return rows.map(({ minCondition, ...copy }) => ({
      ...copy,
      belowMinimum: !!minCondition && isBelowCondition(copy.condition, minCondition),
    }));
  }),
});
