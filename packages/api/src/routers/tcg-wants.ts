import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import {
  tcgArtwork,
  tcgCard,
  tcgConditionEnum,
  tcgLanguageEnum,
  tcgPrinting,
  tcgWant,
  tcgWantStatusEnum,
} from "@life-tracker/db/schema/index";

import { protectedProcedure, router } from "../index";

const terms = z.object({
  /** Accepted languages: Japanese, English, or both. */
  languages: z
    .array(z.enum(tcgLanguageEnum.enumValues))
    .min(1, "Pick at least one language")
    .transform((langs) => [...new Set(langs)]),
  /** Maximum delivered price, USD. */
  maxPrice: z.number().positive().finite(),
  minCondition: z.enum(tcgConditionEnum.enumValues),
});

/** Wants (KOI-308): the Artworks the user is after. */
export const tcgWantsRouter = router({
  /** The caller's Wants in one status (open by default), newest first, with their Artwork. */
  list: protectedProcedure
    .input(z.object({ status: z.enum(tcgWantStatusEnum.enumValues).default("open") }).default({ status: "open" }))
    .query(({ ctx, input }) =>
      db
        .select({
          id: tcgWant.id,
          variantId: tcgWant.variantId,
          languages: tcgWant.languages,
          maxPrice: tcgWant.maxPrice,
          minCondition: tcgWant.minCondition,
          status: tcgWant.status,
          createdAt: tcgWant.createdAt,
          cardNumber: tcgArtwork.cardNumber,
          variantKind: tcgArtwork.variantKind,
          nameEn: tcgCard.nameEn,
          nameJa: tcgCard.nameJa,
          // Japanese first (enum order), like browse.
          imageUrl: sql<string | null>`(select ${tcgPrinting.imageUrl} from ${tcgPrinting} where ${tcgPrinting.variantId} = ${tcgWant.variantId} order by ${tcgPrinting.language} limit 1)`,
        })
        .from(tcgWant)
        .innerJoin(tcgArtwork, eq(tcgArtwork.variantId, tcgWant.variantId))
        .innerJoin(tcgCard, eq(tcgCard.number, tcgArtwork.cardNumber))
        .where(and(eq(tcgWant.userId, ctx.session.user.id), eq(tcgWant.status, input.status)))
        .orderBy(desc(tcgWant.createdAt)),
    ),

  create: protectedProcedure
    .input(terms.extend({ variantId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [artwork] = await db
        .select({ variantId: tcgArtwork.variantId })
        .from(tcgArtwork)
        .where(eq(tcgArtwork.variantId, input.variantId))
        .limit(1);
      if (!artwork) throw new TRPCError({ code: "NOT_FOUND", message: "Artwork not found" });

      const [created] = await db
        .insert(tcgWant)
        .values({
          userId: ctx.session.user.id,
          variantId: input.variantId,
          languages: input.languages,
          maxPrice: input.maxPrice,
          minCondition: input.minCondition,
          status: "open",
        })
        .returning({ id: tcgWant.id });
      return created!;
    }),

  /** Edit a Want's terms. */
  update: protectedProcedure.input(terms.extend({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const { id, ...set } = input;
    const [updated] = await db
      .update(tcgWant)
      .set(set)
      .where(and(eq(tcgWant.id, id), eq(tcgWant.userId, ctx.session.user.id)))
      .returning({ id: tcgWant.id });
    if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Want not found" });
    return updated;
  }),

  /** open → dropped: abandon a Want without deleting it. */
  drop: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => transition(ctx.session.user.id, input.id, "open", "dropped")),

  /** dropped → open. */
  reopen: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => transition(ctx.session.user.id, input.id, "dropped", "open")),
});

type WantStatus = (typeof tcgWantStatusEnum.enumValues)[number];

/** Move the caller's Want from `from` to `to`; any other current status is rejected. */
async function transition(userId: string, id: string, from: WantStatus, to: WantStatus) {
  const owned = and(eq(tcgWant.id, id), eq(tcgWant.userId, userId));
  const [want] = await db.select({ status: tcgWant.status }).from(tcgWant).where(owned).limit(1);
  if (!want) throw new TRPCError({ code: "NOT_FOUND", message: "Want not found" });
  if (want.status !== from) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `A ${want.status} Want can't become ${to}` });
  }
  // The status guard keeps a concurrent change from being overwritten.
  const [updated] = await db
    .update(tcgWant)
    .set({ status: to })
    .where(and(owned, eq(tcgWant.status, from)))
    .returning({ id: tcgWant.id });
  if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Want changed; reload and try again" });
  return updated;
}
