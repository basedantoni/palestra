import { and, asc, eq, exists, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { tcgArtwork, tcgCard, tcgCopy, tcgPrinting, tcgVariantKindEnum, tcgWant } from "@life-tracker/db/schema/index";

import { protectedProcedure, router } from "../index";
import { tcgCopiesRouter } from "./tcg-copies";
import { tcgWantsRouter } from "./tcg-wants";

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const tcgRouter = router({
  copies: tcgCopiesRouter,

  /** Browse the catalog: Artworks with their Card and one Printing per language. */
  artworks: protectedProcedure
    .input(
      z.object({
        /** Substring of the character name, English or Japanese. */
        character: z.string().trim().max(100).optional(),
        set: z.string().max(100).optional(),
        variantKind: z.enum(tcgVariantKindEnum.enumValues).optional(),
        /** Only Artworks the caller owns a Copy of: the collection view. */
        owned: z.boolean().optional(),
        limit: z.number().int().min(1).max(5000).default(200),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: SQL[] = [];
      const owned = exists(
        db
          .select()
          .from(tcgCopy)
          .innerJoin(tcgPrinting, eq(tcgPrinting.id, tcgCopy.printingId))
          .where(and(eq(tcgPrinting.variantId, tcgArtwork.variantId), eq(tcgCopy.userId, ctx.session.user.id))),
      );
      if (input.owned) where.push(owned);
      if (input.character) {
        const pattern = `%${escapeLike(input.character)}%`;
        where.push(or(ilike(tcgCard.nameEn, pattern), ilike(tcgCard.nameJa, pattern))!);
      }
      if (input.set) {
        where.push(
          exists(
            db
              .select()
              .from(tcgPrinting)
              .where(and(eq(tcgPrinting.variantId, tcgArtwork.variantId), eq(tcgPrinting.setName, input.set))),
          ),
        );
      }
      if (input.variantKind) where.push(eq(tcgArtwork.variantKind, input.variantKind));

      const artworks = await db
        .select({
          variantId: tcgArtwork.variantId,
          cardNumber: tcgArtwork.cardNumber,
          nameEn: tcgCard.nameEn,
          nameJa: tcgCard.nameJa,
          variantKind: tcgArtwork.variantKind,
          owned: owned.mapWith(Boolean),
          /** The caller has an open Want for this Artwork. */
          wanted: sql<boolean>`exists (select 1 from ${tcgWant} where ${tcgWant.variantId} = ${tcgArtwork.variantId} and ${tcgWant.userId} = ${ctx.session.user.id} and ${tcgWant.status} = 'open')`,
        })
        .from(tcgArtwork)
        .innerJoin(tcgCard, eq(tcgCard.number, tcgArtwork.cardNumber))
        .where(and(...where))
        .orderBy(asc(tcgArtwork.variantId))
        .limit(input.limit);
      if (artworks.length === 0) return [];

      const printings = await db
        .select({
          id: tcgPrinting.id,
          variantId: tcgPrinting.variantId,
          language: tcgPrinting.language,
          setName: tcgPrinting.setName,
          imageUrl: tcgPrinting.imageUrl,
        })
        .from(tcgPrinting)
        .where(
          inArray(
            tcgPrinting.variantId,
            artworks.map((a) => a.variantId),
          ),
        )
        .orderBy(asc(tcgPrinting.language));

      const byArtwork = new Map(artworks.map((a) => [a.variantId, { ...a, printings: [] as Omit<(typeof printings)[number], "variantId">[] }]));
      for (const { variantId, ...p } of printings) byArtwork.get(variantId)?.printings.push(p);
      return [...byArtwork.values()];
    }),

  wants: tcgWantsRouter,

  /** Set names to filter by. */
  sets: protectedProcedure.query(async () => {
    const rows = await db
      .selectDistinct({ setName: tcgPrinting.setName })
      .from(tcgPrinting)
      .orderBy(asc(tcgPrinting.setName));
    return rows.map((r) => r.setName);
  }),
});
