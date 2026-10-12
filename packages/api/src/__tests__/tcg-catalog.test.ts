/**
 * TCG catalog against a real Postgres (PGlite): the import upsert is idempotent
 * and leaves data it doesn't own alone; browse filters run as SQL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import { tcgArtwork, tcgCard, tcgPrinting } from "@life-tracker/db/schema/index";
import { eq } from "drizzle-orm";

import { applyArtistUpdates, upsertCatalog } from "../lib/tcg/catalog-db";
import { transformCatalog } from "../lib/tcg/catalog-transform";
import { en, ja, packs } from "../lib/tcg/fixtures";
import { appRouter } from "../routers/index";
import { truncateAll } from "./helpers/pglite";

const catalog = transformCatalog({ ja, en, packs });

const caller = appRouter.createCaller({ session: { user: { id: "user-tcg" } } } as any);

const ids = (rows: Array<{ variantId: string }>) => rows.map((r) => r.variantId);

const counts = async () => ({
  cards: (await db.select().from(tcgCard)).length,
  artworks: (await db.select().from(tcgArtwork)).length,
  printings: (await db.select().from(tcgPrinting)).length,
});

const artwork = async (variantId: string) =>
  (await db.select().from(tcgArtwork).where(eq(tcgArtwork.variantId, variantId)))[0];

beforeEach(() => truncateAll(db));

describe("upsertCatalog", () => {
  it("re-running the import creates no duplicates", async () => {
    await upsertCatalog(catalog);
    const first = await counts();
    await upsertCatalog(catalog);

    expect(first).toEqual({
      cards: catalog.cards.length,
      artworks: catalog.artworks.length,
      printings: catalog.printings.length,
    });
    expect(await counts()).toEqual(first);
  });

  it("refreshes catalog fields but keeps an Artwork's artist", async () => {
    await upsertCatalog(catalog);
    await db.update(tcgArtwork).set({ artist: "Nakamaru", artistConflict: true }).where(eq(tcgArtwork.variantId, "OP05-119_p2"));

    const newImage = "https://www.onepiece-cardgame.com/images/cardlist/card/OP05-119_p2.png?999999";
    await upsertCatalog({
      ...catalog,
      printings: catalog.printings.map((p) =>
        p.variantId === "OP05-119_p2" && p.language === "ja" ? { ...p, imageUrl: newImage } : p,
      ),
    });

    const [art] = await db.select().from(tcgArtwork).where(eq(tcgArtwork.variantId, "OP05-119_p2"));
    expect(art).toMatchObject({ artist: "Nakamaru", artistConflict: true, variantKind: "manga" });
    const images = await db
      .select({ imageUrl: tcgPrinting.imageUrl })
      .from(tcgPrinting)
      .where(eq(tcgPrinting.variantId, "OP05-119_p2"));
    expect(images.map((i) => i.imageUrl)).toContain(newImage);
  });
});

describe("applyArtistUpdates", () => {
  beforeEach(() => upsertCatalog(catalog));

  it("writes artist and conflict flag, and a Limitless manga label survives re-importing the catalog", async () => {
    await applyArtistUpdates([
      { variantId: "OP05-119_p1", artist: "Nakamaru", artistConflict: false, manga: true },
      { variantId: "OP05-119_p4", artist: null, artistConflict: true, manga: false },
    ]);
    await upsertCatalog(catalog);

    expect(await artwork("OP05-119_p1")).toMatchObject({ artist: "Nakamaru", artistConflict: false, variantKind: "manga" });
    expect(await artwork("OP05-119_p4")).toMatchObject({ artist: null, artistConflict: true, variantKind: "parallel" });
  });

  it("re-running clears a resolved flag and never demotes a manga", async () => {
    await applyArtistUpdates([{ variantId: "OP05-119_p2", artist: null, artistConflict: true, manga: false }]);
    await applyArtistUpdates([{ variantId: "OP05-119_p2", artist: "Tadaichi Nakama", artistConflict: false, manga: false }]);

    expect(await artwork("OP05-119_p2")).toMatchObject({
      artist: "Tadaichi Nakama",
      artistConflict: false,
      variantKind: "manga",
    });
  });
});

describe("tcg.artworks", () => {
  beforeEach(() => upsertCatalog(catalog));

  it("shows each Artwork's artist, filters by artist, and can show only flagged Artworks", async () => {
    await applyArtistUpdates([
      { variantId: "OP05-119", artist: "Nakamaru", artistConflict: false, manga: false },
      { variantId: "OP05-119_p1", artist: "Tadaichi Nakama", artistConflict: true, manga: false },
      { variantId: "OP08-119", artist: "NAKAMARU", artistConflict: false, manga: false },
    ]);

    const rows = await caller.tcg.artworks({});
    expect(rows.find((r) => r.variantId === "OP05-119")).toMatchObject({ artist: "Nakamaru", artistConflict: false });
    expect(rows.find((r) => r.variantId === "OP05-119_p2")).toMatchObject({ artist: null, artistConflict: false });
    expect(ids(await caller.tcg.artworks({ artist: "nakamaru" }))).toEqual(["OP05-119", "OP08-119"]);
    expect(ids(await caller.tcg.artworks({ conflict: true }))).toEqual(["OP05-119_p1"]);
  });

  it("lists Artworks with their card, kind, and a Printing per language", async () => {
    const rows = await caller.tcg.artworks({});
    expect(rows.find((r) => r.variantId === "OP05-119_p1")).toEqual({
      variantId: "OP05-119_p1",
      cardNumber: "OP05-119",
      nameEn: "Monkey.D.Luffy",
      nameJa: "モンキー・D・ルフィ",
      variantKind: "parallel",
      artist: null,
      artistConflict: false,
      printings: [
        {
          language: "ja",
          setName: "OP-05",
          imageUrl: "https://www.onepiece-cardgame.com/images/cardlist/card/OP05-119_p1.png?260828",
        },
        {
          language: "en",
          setName: "OP-05",
          imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP05-119_p1.png?260929",
        },
      ],
    });
  });

  it("filters by character, in either language", async () => {
    expect(ids(await caller.tcg.artworks({ character: "kaido" }))).toEqual(["OP08-119"]);
    expect(ids(await caller.tcg.artworks({ character: "カイドウ" }))).toEqual(["OP08-119"]);
  });

  it("filters by set", async () => {
    expect(ids(await caller.tcg.artworks({ set: "PRB-01" }))).toEqual(["OP05-119_p3", "OP05-119_p4", "OP05-119_r1"]);
  });

  it("filters by variant kind", async () => {
    expect(ids(await caller.tcg.artworks({ variantKind: "manga" }))).toEqual(["OP05-119_p2"]);
  });

  it("lists the sets to filter by", async () => {
    expect(await caller.tcg.sets()).toEqual(["OP-05", "OP-08", "OP-13", "Other Product Card", "PRB-01"]);
  });
});
