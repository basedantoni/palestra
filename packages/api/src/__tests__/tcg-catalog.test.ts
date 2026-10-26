/**
 * TCG catalog against a real Postgres (PGlite): the import upsert is idempotent,
 * re-pairs English Printings in place and leaves data it doesn't own alone;
 * browse filters run as SQL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import { tcgArtwork, tcgCard, tcgPrinting, user } from "@life-tracker/db/schema/index";
import { and, eq } from "drizzle-orm";

import { applyArtistUpdates, storedPairings, upsertCatalog } from "../lib/tcg/catalog-db";
import { transformCatalog } from "../lib/tcg/catalog-transform";
import { catalog, en, fixtureDistance, ja, packs } from "../lib/tcg/fixtures";
import { pairEnglish } from "../lib/tcg/pairing";
import { appRouter } from "../routers/index";
import { truncateAll } from "./helpers/pglite";

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

/** An English Printing by its list ID. */
const enPrinting = async (listId: string) =>
  (
    await db
      .select()
      .from(tcgPrinting)
      .where(and(eq(tcgPrinting.language, "en"), eq(tcgPrinting.listId, listId)))
  )[0]!;

describe("upsertCatalog re-pairing English Printings (KOI-332)", () => {
  /** The catalog as imported before KOI-332: each English record on the Artwork of its own ID. */
  const unpaired = transformCatalog({ ja, en, packs, pairs: new Map(en.map((r) => [r.id, r.id])) });
  const terms = { languages: ["en" as const], maxPrice: 25, minCondition: "LP" as const };

  beforeEach(async () => {
    await upsertCatalog(unpaired);
    await db.insert(user).values({ id: "user-tcg", name: "user-tcg", email: "user-tcg@test.internal" });
  });

  it("moves an English Printing to its paired Artwork in place, its Copies with it", async () => {
    const before = await enPrinting("OP05-119_p4");
    expect(before.variantId).toBe("OP05-119_p4");
    await caller.tcg.copies.create({ printingId: before.id, condition: "NM", pricePaid: null, acquiredOn: "2026-10-01" });

    const { deleted } = await upsertCatalog(catalog);

    expect(await enPrinting("OP05-119_p4")).toMatchObject({ id: before.id, variantId: "OP05-119_p3" });
    const [copy] = await caller.tcg.copies.list();
    expect(copy).toMatchObject({ printingId: before.id, variantId: "OP05-119_p3" });
    // The Artworks made from English IDs Japanese doesn't have are gone.
    expect(deleted.toSorted()).toEqual([
      "EB01-015_p3",
      "EB01-015_p4",
      "EB01-015_p5",
      "OP01-006_p5",
      "OP05-119_p4",
      "OP09-014_p1",
    ]);
    expect(await artwork("OP05-119_p4")).toBeUndefined();
  });

  it("swaps English Printings between Artworks that both exist (OP01-006)", async () => {
    await upsertCatalog(catalog);

    expect(
      await Promise.all(["OP01-006_p1", "OP01-006_p3", "OP01-006_p4", "OP01-006_p5"].map(async (id) => (await enPrinting(id)).variantId)),
    ).toEqual(["OP01-006_p4", "OP01-006_p1", "OP01-006_p2", "OP01-006_p3"]);
  });

  it.each([
    ["an Art Rating", () => caller.tcg.setRating({ variantId: "OP05-119_p4", rating: 5 })],
    [
      "a Theme tag",
      async () => {
        const theme = await caller.tcg.createTheme({ name: "Luffy" });
        await caller.tcg.tagArtwork({ themeId: theme.id, variantId: "OP05-119_p4" });
      },
    ],
    ["a Want", () => caller.tcg.wants.create({ variantId: "OP05-119_p4", ...terms })],
  ])("rolls back the whole import rather than delete an Artwork with %s", async (_, userData) => {
    await userData();

    await expect(upsertCatalog(catalog)).rejects.toThrow(/OP05-119_p4/);
    expect((await enPrinting("OP05-119_p4")).variantId).toBe("OP05-119_p4");
    expect(await artwork("OP05-119_p4")).toBeDefined();
  });

  it("reports an Offer whose Printing moved off its Want's Artwork", async () => {
    const { id: wantId } = await caller.tcg.wants.create({ variantId: "OP01-006_p3", ...terms });
    const printing = await enPrinting("OP01-006_p3");
    const { id: offerId } = await caller.tcg.offers.create({ wantId, printingId: printing.id, seller: "TCGplayer", price: 9, seenOn: "2026-10-10" });

    const { offerMismatches } = await upsertCatalog(catalog);

    expect(offerMismatches).toEqual([
      { offerId, wantVariantId: "OP01-006_p3", printingVariantId: "OP01-006_p1", listId: "OP01-006_p3" },
    ]);
  });

  it("a second identical import changes nothing", async () => {
    await upsertCatalog(catalog);
    const printings = await db.select().from(tcgPrinting);

    expect(await upsertCatalog(catalog)).toEqual({ deleted: [], offerMismatches: [] });
    expect(await db.select().from(tcgPrinting)).toEqual(expect.arrayContaining(printings));
    expect(await counts()).toMatchObject({ printings: printings.length });
  });
});

describe("storedPairings", () => {
  it("lets the next import re-pair from the database alone, fetching no images", async () => {
    await upsertCatalog(catalog);
    const stored = await storedPairings();
    expect(stored.pairs.get("OP05-119_p4")).toBe("OP05-119_p3");
    expect(stored.pairs.get("EB01-015_p2")).toBeNull();

    const again = pairEnglish({ ja, en, overrides: {}, stored, distance: () => undefined });
    expect(again.needsImages).toEqual({ en: [], ja: [] });
    expect(again.pairs).toEqual(pairEnglish({ ja, en, overrides: {}, distance: fixtureDistance }).pairs);
  });
});

describe("applyArtistUpdates", () => {
  beforeEach(() => upsertCatalog(catalog));

  it("writes artist and conflict flag, and a Limitless manga label survives re-importing the catalog", async () => {
    await applyArtistUpdates([
      { variantId: "OP05-119_p1", artist: "Nakamaru", artistConflict: false, manga: true },
      { variantId: "OP05-119_p3", artist: null, artistConflict: true, manga: false },
    ]);
    await upsertCatalog(catalog);

    expect(await artwork("OP05-119_p1")).toMatchObject({ artist: "Nakamaru", artistConflict: false, variantKind: "manga" });
    expect(await artwork("OP05-119_p3")).toMatchObject({ artist: null, artistConflict: true, variantKind: "parallel" });
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
      owned: false,
      wanted: false,
      rating: null,
      themes: [],
      printings: [
        {
          id: expect.any(String),
          language: "ja",
          setName: "OP-05",
          imageUrl: "https://www.onepiece-cardgame.com/images/cardlist/card/OP05-119_p1.png?260828",
        },
        {
          id: expect.any(String),
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

  it("filters by set, a reprint under its Japanese variant ID", async () => {
    expect(ids(await caller.tcg.artworks({ set: "OP-09" }))).toEqual(["OP05-119_p5", "OP09-014"]);
  });

  it("filters by variant kind", async () => {
    expect(ids(await caller.tcg.artworks({ variantKind: "manga" }))).toEqual(["OP05-119_p2"]);
  });

  it("sections Artworks by card-number prefix, with counts", async () => {
    expect(await caller.tcg.artworkSections({})).toEqual([
      { key: "EB01", count: 7 },
      { key: "OP01", count: 6 },
      { key: "OP05", count: 10 },
      { key: "OP07", count: 1 },
      { key: "OP08", count: 1 },
      { key: "OP09", count: 5 },
      { key: "OP13", count: 2 },
    ]);
  });

  it("filters narrow the sections and their counts", async () => {
    await applyArtistUpdates([
      { variantId: "OP05-119", artist: "Nakamaru", artistConflict: false, manga: false },
      { variantId: "OP08-119", artist: "NAKAMARU", artistConflict: false, manga: false },
    ]);
    expect(await caller.tcg.artworkSections({ artist: "nakamaru" })).toEqual([
      { key: "OP05", count: 1 },
      { key: "OP08", count: 1 },
    ]);
    expect(await caller.tcg.artworkSections({ character: "nobody" })).toEqual([]);
  });

  it("counts by the caller's Art Ratings and Copies", async () => {
    await db.insert(user).values({ id: "user-tcg", name: "user-tcg", email: "user-tcg@test.internal" });
    await caller.tcg.setRating({ variantId: "OP13-118", rating: 4 });
    await caller.tcg.setRating({ variantId: "OP05-119", rating: 2 });
    expect(await caller.tcg.artworkSections({ minRating: 3 })).toEqual([{ key: "OP13", count: 1 }]);

    const [kaido] = await caller.tcg.artworks({ section: "OP08" });
    await caller.tcg.copies.create({
      printingId: kaido!.printings[0]!.id,
      condition: "NM",
      pricePaid: null,
      acquiredOn: "2026-10-01",
    });
    expect(await caller.tcg.artworkSections({ owned: true })).toEqual([{ key: "OP08", count: 1 }]);
  });

  it("sorted by Art Rating, sections by rating, highest first and unrated last", async () => {
    await db.insert(user).values({ id: "user-tcg", name: "user-tcg", email: "user-tcg@test.internal" });
    await caller.tcg.setRating({ variantId: "OP13-118", rating: 4 });
    await caller.tcg.setRating({ variantId: "OP08-119", rating: 4 });
    await caller.tcg.setRating({ variantId: "OP05-119", rating: 2 });
    await caller.tcg.setRating({ variantId: "OP07-091_p1", rating: 0 });

    expect(await caller.tcg.artworkSections({ sort: "rating" })).toEqual([
      { key: "4", count: 2 },
      { key: "2", count: 1 },
      { key: "0", count: 1 },
      { key: "unrated", count: 28 },
    ]);
    expect(await caller.tcg.artworkSections({ sort: "rating", minRating: 3 })).toEqual([{ key: "4", count: 2 }]);
    expect(ids(await caller.tcg.artworks({ sort: "rating", section: "4" }))).toEqual(["OP08-119", "OP13-118"]);
    expect(await caller.tcg.artworks({ sort: "rating", section: "unrated" })).toHaveLength(28);
  });

  it("lists one section's Artworks, reprints under their Card's prefix", async () => {
    expect(ids(await caller.tcg.artworks({ section: "OP13" }))).toEqual(["OP13-118", "OP13-118_p3"]);
    expect(ids(await caller.tcg.artworks({ section: "OP05", set: "PRB-01" }))).toEqual([
      "OP05-119_p3",
      "OP05-119_r1",
      "OP05-119_r2",
    ]);
  });

  it("lists the sets to filter by", async () => {
    expect(await caller.tcg.sets()).toEqual([
      "EB-01",
      "OP-01",
      "OP-05",
      "OP-08",
      "OP-09",
      "OP-11",
      "OP-13",
      "Other Product Card",
      "PRB-01",
      "PRB-02",
      "Promotion card",
      "ST-23",
      "ST-24",
    ]);
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

  it("compares Offers in both languages on the Wants list (KOI-310)", async () => {
    const { id: wantId } = await caller.tcg.wants.create({ ...terms, variantId: "OP05-119_p1", languages: ["ja", "en"] });
    const [listed] = await caller.tcg.wants.list();
    const printing = Object.fromEntries(listed!.printings.map((p) => [p.language, p.id]));
    expect(Object.keys(printing).toSorted()).toEqual(["en", "ja"]);

    const offer = { wantId, seller: "Card Rush", seenOn: "2026-10-10" };
    const { id: ja } = await caller.tcg.offers.create({ ...offer, printingId: printing.ja!, price: 26 });
    await caller.tcg.offers.create({ ...offer, printingId: printing.en!, seller: "TCGplayer", price: 31 });
    const [base] = await db
      .select({ id: tcgPrinting.id })
      .from(tcgPrinting)
      .where(eq(tcgPrinting.variantId, "OP05-119"))
      .limit(1);
    await expect(caller.tcg.offers.create({ ...offer, printingId: base!.id, price: 5 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(other.tcg.offers.create({ ...offer, printingId: printing.ja!, price: 5 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(other.tcg.offers.delete({ id: ja })).rejects.toMatchObject({ code: "NOT_FOUND" });

    let [row] = await caller.tcg.wants.list();
    expect(row!.offers.map((o) => [o.seller, o.language, o.price, o.seenOn])).toEqual([
      ["Card Rush", "ja", 26, "2026-10-10"],
      ["TCGplayer", "en", 31, "2026-10-10"],
    ]);
    expect(row!.buyable).toBe(false); // max 25

    await caller.tcg.offers.update({ ...offer, id: ja, printingId: printing.ja!, price: 24, url: "https://example.com/x" });
    [row] = await caller.tcg.wants.list();
    expect(row!.cheapest).toMatchObject({ id: ja, price: 24, url: "https://example.com/x" });
    expect(row!.buyable).toBe(true);

    await caller.tcg.offers.delete({ id: ja });
    [row] = await caller.tcg.wants.list();
    expect(row!.offers.map((o) => o.seller)).toEqual(["TCGplayer"]);
  });
});
