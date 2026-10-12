/**
 * TCG catalog against a real Postgres (PGlite): the import upsert is idempotent
 * and leaves data it doesn't own alone; browse filters run as SQL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import { tcgArtwork, tcgCard, tcgPrinting, user } from "@life-tracker/db/schema/index";
import { eq } from "drizzle-orm";

import { upsertCatalog } from "../lib/tcg/catalog-db";
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

describe("tcg.artworks", () => {
  beforeEach(() => upsertCatalog(catalog));

  it("lists Artworks with their card, kind, and a Printing per language", async () => {
    const rows = await caller.tcg.artworks({});
    expect(rows.find((r) => r.variantId === "OP05-119_p1")).toEqual({
      variantId: "OP05-119_p1",
      cardNumber: "OP05-119",
      nameEn: "Monkey.D.Luffy",
      nameJa: "モンキー・D・ルフィ",
      variantKind: "parallel",
      wanted: false,
      rating: null,
      themes: [],
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

/** Luffy Artworks browse marks as Wanted. */
const wanted = async () => ids((await caller.tcg.artworks({ character: "luffy" })).filter((a) => a.wanted));

describe("Wants against the catalog (KOI-308)", () => {
  const other = appRouter.createCaller({ session: { user: { id: "user-other" } } } as any);
  const terms = { languages: ["ja" as const], maxPrice: 25, minCondition: "LP" as const };

  beforeEach(async () => {
    await upsertCatalog(catalog);
    for (const id of ["user-tcg", "user-other"]) {
      await db.insert(user).values({ id, name: id, email: `${id}@test.internal` });
    }
  });

  it("browse marks only Artworks with the caller's open Want", async () => {
    const { id } = await caller.tcg.wants.create({ variantId: "OP05-119_p1", ...terms });
    await caller.tcg.wants.create({ variantId: "OP05-119_p1", ...terms }); // a second Want is fine
    await other.tcg.wants.create({ variantId: "OP05-119_p2", ...terms });
    expect(await wanted()).toEqual(["OP05-119_p1"]);

    await caller.tcg.wants.drop({ id });
    expect(await wanted()).toEqual(["OP05-119_p1"]);
    const [second] = await caller.tcg.wants.list();
    await caller.tcg.wants.drop({ id: second!.id });
    expect(await wanted()).toEqual([]);
  });

  it("lists open and dropped Wants with their Artwork", async () => {
    const { id } = await caller.tcg.wants.create({ variantId: "OP05-119_p1", ...terms });
    await caller.tcg.wants.drop({ id });

    expect(await caller.tcg.wants.list()).toEqual([]);
    expect(await caller.tcg.wants.list({ status: "dropped" })).toEqual([
      expect.objectContaining({
        id,
        variantId: "OP05-119_p1",
        nameEn: "Monkey.D.Luffy",
        languages: ["ja"],
        maxPrice: 25,
        minCondition: "LP",
        status: "dropped",
        imageUrl: "https://www.onepiece-cardgame.com/images/cardlist/card/OP05-119_p1.png?260828",
      }),
    ]);
    expect(await other.tcg.wants.list({ status: "dropped" })).toEqual([]);
  });
});
