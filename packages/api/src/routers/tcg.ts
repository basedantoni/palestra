import { and, asc, eq, exists, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { db } from "@life-tracker/db";
import {
  tcgArtRating,
  tcgArtwork,
  tcgArtworkTheme,
  tcgCard,
  tcgCopy,
  tcgLanguageEnum,
  tcgPrinting,
  tcgTheme,
  tcgVariantKindEnum,
  tcgWant,
} from "@life-tracker/db/schema/index";

import { TCG_ARTWORKS_MAX_LIMIT } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import { isForeignKeyViolation, isUniqueViolation } from "../lib/pg-error";
import { tcgCopiesRouter } from "./tcg-copies";
import { tcgFundRouter } from "./tcg-fund";
import { tcgOffersRouter } from "./tcg-offers";
import { tcgWantsRouter } from "./tcg-wants";

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A write naming a variant ID that isn't in the catalog fails its foreign key. */
function artworkNotFound(err: unknown): never {
  if (isForeignKeyViolation(err)) throw new TRPCError({ code: "NOT_FOUND", message: "Artwork not found" });
  throw err;
}

function duplicateThemeName(err: unknown): never {
  if (isUniqueViolation(err)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "You already have a Theme with that name" });
  }
  throw err;
}

const themeNotFound = () => new TRPCError({ code: "NOT_FOUND", message: "Theme not found" });

const themeName = z.string().trim().min(1, "Theme name is required").max(100);

const tagInput = z.object({ themeId: z.string().uuid(), variantId: z.string().min(1) });

async function assertOwnedTheme(userId: string, themeId: string) {
  const [owned] = await db
    .select({ id: tcgTheme.id })
    .from(tcgTheme)
    .where(and(eq(tcgTheme.id, themeId), eq(tcgTheme.userId, userId)))
    .limit(1);
  if (!owned) throw themeNotFound();
}

export const tcgRouter = router({
  copies: tcgCopiesRouter,
  fund: tcgFundRouter,

  /** Browse the catalog: Artworks with their Card and one Printing per language. */
  artworks: protectedProcedure
    .input(
      z.object({
        /** Substring of the character name, English or Japanese. */
        character: z.string().trim().max(100).optional(),
        set: z.string().max(100).optional(),
        variantKind: z.enum(tcgVariantKindEnum.enumValues).optional(),
        /** Substring of the credited artist. */
        artist: z.string().trim().max(100).optional(),
        /** Only Artworks whose Japanese and English sources disagree on the artist. */
        conflict: z.boolean().optional(),
        /** Only Artworks the caller owns a Copy of: the collection view. */
        owned: z.boolean().optional(),
        /** Only Artworks printed in this language; with `owned`, owned as a Copy in this language. */
        language: z.enum(tcgLanguageEnum.enumValues).optional(),
        limit: z.number().int().min(1).max(TCG_ARTWORKS_MAX_LIMIT).default(200),
        /** Only Artworks the caller rated at least this. */
        minRating: z.number().int().min(0).max(5).optional(),
        /** Only Artworks tagged with this Theme of the caller's. */
        themeId: z.string().uuid().optional(),
        /** `rating`: highest Art Rating first, unrated last. */
        sort: z.enum(["variant", "rating"]).default("variant"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const where: SQL[] = [];
      const ownedIn = (language?: (typeof tcgLanguageEnum.enumValues)[number]) =>
        exists(
          db
            .select()
            .from(tcgCopy)
            .innerJoin(tcgPrinting, eq(tcgPrinting.id, tcgCopy.printingId))
            .where(
              and(
                eq(tcgPrinting.variantId, tcgArtwork.variantId),
                eq(tcgCopy.userId, userId),
                language ? eq(tcgPrinting.language, language) : undefined,
              ),
            ),
        );
      const owned = ownedIn();
      if (input.owned) where.push(ownedIn(input.language));
      else if (input.language) {
        where.push(
          exists(
            db
              .select()
              .from(tcgPrinting)
              .where(and(eq(tcgPrinting.variantId, tcgArtwork.variantId), eq(tcgPrinting.language, input.language))),
          ),
        );
      }
      if (input.minRating !== undefined) where.push(gte(tcgArtRating.rating, input.minRating));
      if (input.themeId) {
        where.push(
          exists(
            db
              .select()
              .from(tcgArtworkTheme)
              .innerJoin(tcgTheme, eq(tcgTheme.id, tcgArtworkTheme.themeId))
              .where(
                and(
                  eq(tcgArtworkTheme.variantId, tcgArtwork.variantId),
                  eq(tcgArtworkTheme.themeId, input.themeId),
                  eq(tcgTheme.userId, userId),
                ),
              ),
          ),
        );
      }
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
      if (input.artist) where.push(ilike(tcgArtwork.artist, `%${escapeLike(input.artist)}%`));
      if (input.conflict) where.push(eq(tcgArtwork.artistConflict, true));

      const artworks = await db
        .select({
          variantId: tcgArtwork.variantId,
          cardNumber: tcgArtwork.cardNumber,
          nameEn: tcgCard.nameEn,
          nameJa: tcgCard.nameJa,
          variantKind: tcgArtwork.variantKind,
          artist: tcgArtwork.artist,
          artistConflict: tcgArtwork.artistConflict,
          owned: owned.mapWith(Boolean),
          /** The caller has an open Want for this Artwork. */
          wanted: sql<boolean>`exists (select 1 from ${tcgWant} where ${tcgWant.variantId} = ${tcgArtwork.variantId} and ${tcgWant.userId} = ${ctx.session.user.id} and ${tcgWant.status} = 'open')`,
          rating: tcgArtRating.rating,
        })
        .from(tcgArtwork)
        .innerJoin(tcgCard, eq(tcgCard.number, tcgArtwork.cardNumber))
        .leftJoin(
          tcgArtRating,
          and(eq(tcgArtRating.variantId, tcgArtwork.variantId), eq(tcgArtRating.userId, userId)),
        )
        .where(and(...where))
        .orderBy(
          ...(input.sort === "rating" ? [sql`${tcgArtRating.rating} desc nulls last`] : []),
          asc(tcgArtwork.variantId),
        )
        .limit(input.limit);
      if (artworks.length === 0) return [];
      const variantIds = artworks.map((a) => a.variantId);

      const printings = await db
        .select({
          id: tcgPrinting.id,
          variantId: tcgPrinting.variantId,
          language: tcgPrinting.language,
          setName: tcgPrinting.setName,
          imageUrl: tcgPrinting.imageUrl,
        })
        .from(tcgPrinting)
        .where(inArray(tcgPrinting.variantId, variantIds))
        .orderBy(asc(tcgPrinting.language));

      const tags = await db
        .select({ variantId: tcgArtworkTheme.variantId, id: tcgTheme.id, name: tcgTheme.name })
        .from(tcgArtworkTheme)
        .innerJoin(tcgTheme, eq(tcgTheme.id, tcgArtworkTheme.themeId))
        .where(and(eq(tcgTheme.userId, userId), inArray(tcgArtworkTheme.variantId, variantIds)))
        .orderBy(asc(tcgTheme.name));

      const byArtwork = new Map(
        artworks.map((a) => [
          a.variantId,
          {
            ...a,
            printings: [] as Omit<(typeof printings)[number], "variantId">[],
            themes: [] as Array<{ id: string; name: string }>,
          },
        ]),
      );
      for (const { variantId, ...p } of printings) byArtwork.get(variantId)?.printings.push(p);
      for (const { variantId, ...t } of tags) byArtwork.get(variantId)?.themes.push(t);
      return [...byArtwork.values()];
    }),

  wants: tcgWantsRouter,
  offers: tcgOffersRouter,

  /** Set, change (0–5), or clear (null) the caller's Art Rating of an Artwork. */
  setRating: protectedProcedure
    .input(z.object({ variantId: z.string().min(1), rating: z.number().int().min(0).max(5).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { variantId, rating } = input;
      if (rating === null) {
        await db
          .delete(tcgArtRating)
          .where(and(eq(tcgArtRating.userId, userId), eq(tcgArtRating.variantId, variantId)));
        return;
      }
      await db
        .insert(tcgArtRating)
        .values({ userId, variantId, rating })
        .onConflictDoUpdate({ target: [tcgArtRating.userId, tcgArtRating.variantId], set: { rating } })
        .catch(artworkNotFound);
    }),

  /** The caller's Themes, by name. */
  themes: protectedProcedure.query(({ ctx }) =>
    db
      .select({ id: tcgTheme.id, name: tcgTheme.name })
      .from(tcgTheme)
      .where(eq(tcgTheme.userId, ctx.session.user.id))
      .orderBy(asc(tcgTheme.name)),
  ),

  createTheme: protectedProcedure.input(z.object({ name: themeName })).mutation(async ({ ctx, input }) => {
    const [theme] = await db
      .insert(tcgTheme)
      .values({ id: randomUUID(), userId: ctx.session.user.id, name: input.name })
      .returning({ id: tcgTheme.id, name: tcgTheme.name })
      .catch(duplicateThemeName);
    return theme!;
  }),

  renameTheme: protectedProcedure
    .input(z.object({ id: z.string().uuid(), name: themeName }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .update(tcgTheme)
        .set({ name: input.name })
        .where(and(eq(tcgTheme.id, input.id), eq(tcgTheme.userId, ctx.session.user.id)))
        .returning({ id: tcgTheme.id })
        .catch(duplicateThemeName);
      if (!row) throw themeNotFound();
    }),

  /** Deletes the Theme; its tags go with it (FK cascade). */
  deleteTheme: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db
      .delete(tcgTheme)
      .where(and(eq(tcgTheme.id, input.id), eq(tcgTheme.userId, ctx.session.user.id)))
      .returning({ id: tcgTheme.id });
    if (!row) throw themeNotFound();
  }),

  tagArtwork: protectedProcedure.input(tagInput).mutation(async ({ ctx, input }) => {
    await assertOwnedTheme(ctx.session.user.id, input.themeId);
    await db.insert(tcgArtworkTheme).values(input).onConflictDoNothing().catch(artworkNotFound);
  }),

  untagArtwork: protectedProcedure.input(tagInput).mutation(async ({ ctx, input }) => {
    await assertOwnedTheme(ctx.session.user.id, input.themeId);
    await db
      .delete(tcgArtworkTheme)
      .where(and(eq(tcgArtworkTheme.themeId, input.themeId), eq(tcgArtworkTheme.variantId, input.variantId)));
  }),

  /** Set names to filter by. */
  sets: protectedProcedure.query(async () => {
    const rows = await db
      .selectDistinct({ setName: tcgPrinting.setName })
      .from(tcgPrinting)
      .orderBy(asc(tcgPrinting.setName));
    return rows.map((r) => r.setName);
  }),
});
