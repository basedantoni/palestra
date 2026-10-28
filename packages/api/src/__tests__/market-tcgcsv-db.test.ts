/**
 * TCGCSV capture against a real Postgres (PGlite, KOI-366): the job with recorded TCGCSV responses
 * (OP01, OP05 and the OP05 anniversary group, recorded 2026-10-27) for fetch and an in-memory
 * bucket for Tigris.
 *
 * - a capture lands the raw responses at raw/tcgcsv/<day>/ before deriving
 * - one NM USD row per matched English Printing; sealed and DON!! products dropped
 * - a null marketPrice writes no row; Normal wins over Foil; the lowest of several products wins
 * - unmatched products are listed with a reason; manual rows survive re-runs
 * - re-running or replaying a day replaces it exactly
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { tcgArtwork, tcgCard, tcgMarketPrice, tcgMarketplaceProduct, tcgPrinting } from "@life-tracker/db/schema/index";
import { and, asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { captureTcgcsv, deriveMarketDay, type MarketDb } from "../lib/market/capture";
import { type ArtworkChooser, TYPESAFE_GATE } from "../lib/market/typesafe-tier";
import { fakeChooser } from "./helpers/fake-chooser";
import { memoryStore } from "./helpers/memory-store";
import { pgliteDbModule, truncateAll } from "./helpers/pglite";

const DAY = "2026-10-27";
const FIXTURES = join(import.meta.dirname, "../lib/market/fixtures/tcgcsv");

/**
 * fetch answering TCGCSV URLs from the recorded responses. Like TCGCSV, it refuses a request with no
 * User-Agent (Node's fetch sends none).
 */
function recordedTcgcsv() {
  const calls: string[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url));
    if (!new Headers(init?.headers).get("user-agent")) return new Response("Unauthorized", { status: 401 });
    const path = /tcgplayer\/68\/(?:(\d+)\/(products|prices)|groups)$/.exec(String(url));
    if (!path) return new Response("Not Found", { status: 404 });
    const file = path[1] ? `${path[1]}-${path[2]}.json` : "groups.json";
    return new Response(readFileSync(join(FIXTURES, file)));
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/** Artworks for the fixture's cards: [variant ID, kind, set of its Printings]. Each has a JA and an EN Printing. */
const CATALOG = [
  ["OP01-002", "base", "OP-01"],
  ["OP01-002_p1", "parallel", "OP-01"],
  ["OP01-005", "base", "OP-01"],
  ["OP01-120", "base", "OP-01"],
  ["OP01-120_p1", "parallel", "OP-01"],
  ["OP01-120_p2", "manga", "OP-01"],
  ["OP05-001", "base", "OP-05"],
  ["OP05-001_p1", "parallel", "OP-05"],
  ["OP05-001_p2", "parallel", "EB-02"],
  ["OP05-003", "base", "OP-05"],
  ["OP05-100", "base", "OP-05"],
  ["OP05-100_p1", "parallel", "OP-05"],
  ["OP05-100_p2", "parallel", "OP-05"],
  ["OP05-119", "base", "OP-05"],
  ["OP05-119_p1", "parallel", "OP-05"],
  ["OP05-119_p2", "manga", "OP-05"],
] as const;

async function seedCatalog() {
  const numbers = [...new Set(CATALOG.map(([v]) => v.split("_")[0]!))];
  await db.insert(tcgCard).values(numbers.map((number) => ({ number })));
  await db
    .insert(tcgArtwork)
    .values(CATALOG.map(([variantId, variantKind]) => ({ variantId, variantKind, cardNumber: variantId.split("_")[0]! })));
  await db.insert(tcgPrinting).values(
    CATALOG.flatMap(([variantId, , setName]) =>
      (["ja", "en"] as const).map((language) => ({
        variantId,
        language,
        listId: variantId,
        packId: language === "ja" ? "550000" : "569000",
        setName,
        imageUrl: `https://img.test/${language}/${variantId}.png`,
      })),
    ),
  );
}

/** A day's TCGplayer Market Prices as [Artwork, language, condition, price, supplying product]. */
const pricesOn = (day: string) =>
  db
    .select({
      variantId: tcgPrinting.variantId,
      language: tcgPrinting.language,
      condition: tcgMarketPrice.condition,
      price: tcgMarketPrice.price,
      listingCount: tcgMarketPrice.listingCount,
      product: tcgMarketplaceProduct.externalId,
    })
    .from(tcgMarketPrice)
    .innerJoin(tcgPrinting, eq(tcgPrinting.id, tcgMarketPrice.printingId))
    .innerJoin(tcgMarketplaceProduct, eq(tcgMarketplaceProduct.id, tcgMarketPrice.marketplaceProductId))
    .where(and(eq(tcgMarketPrice.marketplace, "tcgplayer"), eq(tcgMarketPrice.day, day)))
    .orderBy(asc(tcgPrinting.variantId))
    .then((rows) => rows.map((r) => [r.variantId, r.language, r.condition, r.price, r.listingCount, r.product]));

const product = (externalId: string) =>
  db
    .select()
    .from(tcgMarketplaceProduct)
    .where(and(eq(tcgMarketplaceProduct.marketplace, "tcgplayer"), eq(tcgMarketplaceProduct.externalId, externalId)))
    .then(([row]) => row);

/** The admin's fix for a product: a manual match, or "not an Artwork" with no variant ID. */
const matchByHand = (externalId: string, variantId: string | null, name = "manual") =>
  db
    .insert(tcgMarketplaceProduct)
    .values({
      marketplace: "tcgplayer",
      externalId,
      name,
      number: "",
      set: "",
      variantId,
      method: "manual",
      lastSeenOn: "2026-10-01",
    })
    .onConflictDoUpdate({
      target: [tcgMarketplaceProduct.marketplace, tcgMarketplaceProduct.externalId],
      set: { variantId, method: "manual" },
    });

let db: MarketDb;
beforeAll(async () => {
  ({ db } = await pgliteDbModule());
});
beforeEach(async () => {
  await truncateAll(db);
  await seedCatalog();
});

describe("market.tcgcsv capture", () => {
  it("lands every group's raw responses at raw/tcgcsv/<day>/, asking with a User-Agent", async () => {
    const store = memoryStore();
    const { fetch, calls } = recordedTcgcsv();
    await captureTcgcsv({ db, store, fetch }, DAY);

    expect(calls).toHaveLength(7); // groups, then products and prices for each of 3 groups
    const landed = JSON.parse(gunzipSync(store.objects.get(`raw/tcgcsv/${DAY}/tcgcsv.json.gz`)!).toString("utf8"));
    expect(Object.keys(landed.products).toSorted()).toEqual(["23213", "23368", "3188"]);
    expect(landed.prices["3188"]).toEqual(JSON.parse(readFileSync(join(FIXTURES, "3188-prices.json"), "utf8")));
  });

  it("derives one NM USD Market Price per matched English Printing", async () => {
    await captureTcgcsv({ db, store: memoryStore(), fetch: recordedTcgcsv().fetch }, DAY);

    expect(await pricesOn(DAY)).toEqual([
      ["OP01-002", "en", "NM", 1.6, null, "453505"], // Trafalgar Law (002)
      ["OP01-002_p1", "en", "NM", 457.62, null, "454514"], // Trafalgar Law (002) (Parallel)
      ["OP01-005", "en", "NM", 0.29, null, "454517"], // Uta: Normal 0.29 over Foil 0.39
      ["OP01-120", "en", "NM", 7.34, null, "454664"], // Shanks
      ["OP05-001", "en", "NM", 0.19, null, "528529"], // Sabo (001)
      ["OP05-001_p1", "en", "NM", 14.58, null, "527007"], // Sabo (001) (Alternate Art): _p2 is in EB-02
      ["OP05-003", "en", "NM", 0.26, null, "528532"], // Inazuma
      ["OP05-100", "en", "NM", 0.54, null, "527022"], // Enel (100)
      ["OP05-119", "en", "NM", 20.9, null, "527024"], // Monkey.D.Luffy (119)
    ]);
  });

  it("records each card product it saw, and why the unmatched ones have no Artwork", async () => {
    await captureTcgcsv({ db, store: memoryStore(), fetch: recordedTcgcsv().fetch }, DAY);

    const products = await db.select().from(tcgMarketplaceProduct).orderBy(asc(tcgMarketplaceProduct.externalId));
    expect(products).toHaveLength(13); // sealed and DON!! are not Marketplace Products
    expect(products.every((p) => p.lastSeenOn === DAY && p.method === "rule")).toBe(true);
    expect(await product("453505")).toMatchObject({
      name: "Trafalgar Law (002)",
      number: "OP01-002",
      set: "OP01",
      variantId: "OP01-002",
      reason: null,
      matchedAt: expect.any(Date),
    });
    expect(
      products.filter((p) => p.variantId === null).map((p) => [p.externalId, p.name, p.reason]),
    ).toEqual([
      ["454665", "Shanks (Parallel)", "2 candidate Artworks in OP01: OP01-120_p1, OP01-120_p2"],
      ["527026", "Monkey.D.Luffy (119) (Alternate Art) (Manga)", "2 candidate Artworks in OP05: OP05-119_p1, OP05-119_p2"],
      ["527043", "Enel (100) (SP)", "2 candidate Artworks in OP05: OP05-100_p1, OP05-100_p2"],
      ["530887", "Inazuma", "No Artwork of OP05-003 has an English Printing in OP05 ANN"],
    ]);
  });

  it("counts an Artwork once when two of its English Printings are in the same set", async () => {
    // A second OP-05 English Printing of the Sabo alt art, spelled as a set code without the dash.
    await db.insert(tcgPrinting).values({
      variantId: "OP05-001_p1",
      language: "en",
      listId: "OP05-001_p1-promo",
      packId: "569999",
      setName: "OP05",
      imageUrl: "https://img.test/en/OP05-001_p1-promo.png",
    });
    await captureTcgcsv({ db, store: memoryStore(), fetch: recordedTcgcsv().fetch }, DAY);

    expect(await product("527007")).toMatchObject({ variantId: "OP05-001_p1", reason: null });
  });

  it("forgets a product whose Artwork is deleted, so a manual match never turns into 'not an Artwork'", async () => {
    await matchByHand("454665", "OP01-120_p1");
    await db.delete(tcgArtwork).where(eq(tcgArtwork.variantId, "OP01-120_p1"));
    expect(await product("454665")).toBeUndefined();

    // Seen again as new, it goes back through the matcher: `_p2` is now its only non-base candidate.
    await captureTcgcsv({ db, store: memoryStore(), fetch: recordedTcgcsv().fetch }, DAY);
    expect(await product("454665")).toMatchObject({ method: "rule", variantId: "OP01-120_p2", reason: null });
  });

  it("writes no row for a matched product with a null marketPrice", async () => {
    await matchByHand("527026", "OP05-119_p2");
    await captureTcgcsv({ db, store: memoryStore(), fetch: recordedTcgcsv().fetch }, DAY);

    expect((await pricesOn(DAY)).filter(([variantId]) => variantId === "OP05-119_p2")).toEqual([]);
  });

  it("takes the lowest price among several products on one Artwork and records that product", async () => {
    // The anniversary Inazuma ($18.27), matched by hand to the OP05 Inazuma's Artwork ($0.26).
    await matchByHand("530887", "OP05-003");
    await captureTcgcsv({ db, store: memoryStore(), fetch: recordedTcgcsv().fetch }, DAY);

    expect((await pricesOn(DAY)).filter(([variantId]) => variantId === "OP05-003")).toEqual([
      ["OP05-003", "en", "NM", 0.26, null, "528532"],
    ]);
  });

  it("never overwrites a manual row, a match or 'not an Artwork'", async () => {
    await matchByHand("454665", "OP01-120_p1");
    await matchByHand("453505", null); // "not an Artwork", though the rule would match it
    const deps = { db, store: memoryStore(), fetch: recordedTcgcsv().fetch };
    await captureTcgcsv(deps, DAY);
    await captureTcgcsv(deps, DAY);

    expect(await product("454665")).toMatchObject({ method: "manual", variantId: "OP01-120_p1", lastSeenOn: DAY });
    expect(await product("453505")).toMatchObject({ method: "manual", variantId: null });
    const prices = await pricesOn(DAY);
    expect(prices.filter(([variantId]) => variantId === "OP01-120_p1")).toEqual([
      ["OP01-120_p1", "en", "NM", 76.82, null, "454665"],
    ]);
    expect(prices.filter(([variantId]) => variantId === "OP01-002")).toEqual([]);
  });

  it("fails on an error response and lands nothing", async () => {
    const store = memoryStore();
    const fetch = (async () => new Response("down", { status: 503 })) as typeof globalThis.fetch;

    await expect(captureTcgcsv({ db, store, fetch }, DAY)).rejects.toThrow(/503/);
    expect(store.objects.size).toBe(0);
    expect(await db.select().from(tcgMarketplaceProduct)).toEqual([]);
  });
});

/** A capture with `chooser` as the TypeSafe tier. */
const captureWith = (chooser: ArtworkChooser, store = memoryStore()) =>
  captureTcgcsv({ db, store, fetch: recordedTcgcsv().fetch, chooser }, DAY);

describe("the TypeSafe tier (KOI-371)", () => {
  it("asks only the products the rule tier leaves unmatched, never a manual row, with each card's English Artworks", async () => {
    await matchByHand("454665", "OP01-120_p1");
    const { chooser, asked } = fakeChooser();
    await captureWith(chooser);

    expect(asked.map((a) => a.product.name).toSorted()).toEqual([
      "Enel (100) (SP)",
      "Inazuma",
      "Monkey.D.Luffy (119) (Alternate Art) (Manga)",
    ]);
    const luffy = asked.find((a) => a.product.name.startsWith("Monkey"))!;
    expect(luffy.product).toEqual({
      marketplace: "tcgplayer",
      name: "Monkey.D.Luffy (119) (Alternate Art) (Manga)",
      number: "OP05-119",
      set: "OP05",
      rarity: "SEC",
      tags: ["Alternate Art", "Manga"],
    });
    expect(luffy.candidates).toEqual([
      { variantId: "OP05-119", variantKind: "base", sets: ["OP-05"], rarity: null, artist: null },
      { variantId: "OP05-119_p1", variantKind: "parallel", sets: ["OP-05"], rarity: null, artist: null },
      { variantId: "OP05-119_p2", variantKind: "manga", sets: ["OP-05"], rarity: null, artist: null },
    ]);
    // Inazuma's anniversary product has no candidate in its set, but its card's Artwork is one.
    expect(asked.find((a) => a.product.name === "Inazuma")!.candidates.map((c) => c.variantId)).toEqual(["OP05-003"]);
  });

  it("stores a choice at or above the gate with method typesafe and its confidence, and prices it", async () => {
    const { chooser } = fakeChooser({ "Enel (100) (SP)": { choice: "OP05-100_p2", confidence: 0.97 } });
    const result = await captureWith(chooser);

    expect(await product("527043")).toMatchObject({
      method: "typesafe",
      variantId: "OP05-100_p2",
      confidence: expect.closeTo(0.97, 5),
      reason: null,
      matchedAt: expect.any(Date),
    });
    expect((await pricesOn(DAY)).filter(([v]) => v === "OP05-100_p2")).toEqual([
      ["OP05-100_p2", "en", "NM", 91.07, null, "527043"],
    ]);
    expect(result).toMatchObject({ unmatched: 3 });
  });

  it("leaves a choice below the gate unmatched, with a reason naming the tier", async () => {
    const { chooser } = fakeChooser({ "Enel (100) (SP)": { choice: "OP05-100_p2", confidence: 0.4 } });
    await captureWith(chooser);

    expect(await product("527043")).toMatchObject({
      method: "rule",
      variantId: null,
      confidence: null,
      reason: `2 candidate Artworks in OP05: OP05-100_p1, OP05-100_p2; TypeSafe tier: OP05-100_p2 at confidence 0.40, below the ${TYPESAFE_GATE} gate`,
    });
  });

  it("leaves a product unmatched on 'none', with a reason naming the tier", async () => {
    const { chooser } = fakeChooser({ Inazuma: { choice: "none", confidence: 0.99 } });
    await captureWith(chooser);

    expect(await product("530887")).toMatchObject({
      variantId: null,
      reason: "No Artwork of OP05-003 has an English Printing in OP05 ANN; TypeSafe tier: none of the 1 candidate Artworks fits",
    });
  });

  it("does not ask again for a product it matched, but asks again for one it left unmatched", async () => {
    const store = memoryStore();
    const { chooser, asked } = fakeChooser({ "Enel (100) (SP)": { choice: "OP05-100_p2", confidence: 0.97 } });
    await captureWith(chooser, store);
    await captureWith(chooser, store);
    await deriveMarketDay({ db, store, chooser }, { source: "tcgcsv", day: DAY });

    const names = asked.map((a) => a.product.name);
    expect(names.filter((n) => n === "Enel (100) (SP)")).toHaveLength(1);
    expect(names.filter((n) => n === "Inazuma")).toHaveLength(3);
    expect(await product("527043")).toMatchObject({ method: "typesafe", variantId: "OP05-100_p2" });
  });

  it("leaves a product unmatched when TypeSafe fails, and still derives the day", async () => {
    const { chooser } = fakeChooser({ "Enel (100) (SP)": new Error("TypeSafe answered 503") });
    await captureWith(chooser);

    expect(await product("527043")).toMatchObject({
      variantId: null,
      reason: "2 candidate Artworks in OP05: OP05-100_p1, OP05-100_p2; TypeSafe tier failed: TypeSafe answered 503",
    });
    expect(await pricesOn(DAY)).toHaveLength(9);
  });
});

describe("re-running and replaying a TCGCSV day", () => {
  it("leaves exactly one set of rows when the same day runs twice", async () => {
    const deps = { db, store: memoryStore(), fetch: recordedTcgcsv().fetch };
    await captureTcgcsv(deps, DAY);
    await captureTcgcsv(deps, DAY);

    expect(await pricesOn(DAY)).toHaveLength(9);
    expect(await db.select().from(tcgMarketplaceProduct)).toHaveLength(13);
  });

  it("moves a product's price to its new Artwork on replay, leaving no stale row", async () => {
    const store = memoryStore();
    await matchByHand("454665", "OP01-120_p1");
    await captureTcgcsv({ db, store, fetch: recordedTcgcsv().fetch }, DAY);

    await matchByHand("454665", "OP01-120_p2");
    await deriveMarketDay({ db, store }, { source: "tcgcsv", day: DAY });

    const shanks = (await pricesOn(DAY)).filter(([variantId]) => String(variantId).startsWith("OP01-120_"));
    expect(shanks).toEqual([["OP01-120_p2", "en", "NM", 76.82, null, "454665"]]);
  });

  it("keeps other days' prices", async () => {
    const store = memoryStore();
    await captureTcgcsv({ db, store, fetch: recordedTcgcsv().fetch }, "2026-10-26");
    await captureTcgcsv({ db, store, fetch: recordedTcgcsv().fetch }, DAY);
    await deriveMarketDay({ db, store }, { source: "tcgcsv", day: DAY });

    expect(await pricesOn("2026-10-26")).toHaveLength(9);
    expect(await pricesOn(DAY)).toHaveLength(9);
  });
});
