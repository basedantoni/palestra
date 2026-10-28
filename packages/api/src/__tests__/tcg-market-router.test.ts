/**
 * Tile prices (KOI-366, KOI-367): each shown Artwork's English Printing priced at its Current Market
 * Price, the latest TCGplayer NM price on or before today (UTC), at most 30 days old and flagged
 * "as of" once older than 7 days, with its 7d Price Move and 30-day sparkline. Real SQL (PGlite).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import {
  exchangeRate,
  tcgArtwork,
  tcgCard,
  tcgCopy,
  tcgMarketPrice,
  tcgMarketplaceProduct,
  tcgOffer,
  tcgPrinting,
  tcgWant,
  user,
} from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { truncateAll } from "./helpers/pglite";

const TODAY = "2026-10-27";
const caller = appRouter.createCaller({ session: { user: { id: "user-market" } } } as any);

/** An Artwork of OP05-119 with a JA and an EN Printing; returns the EN Printing's id. */
async function artwork(variantId: string) {
  await db.insert(tcgArtwork).values({ variantId, cardNumber: "OP05-119", variantKind: "parallel" });
  const [, en] = await db
    .insert(tcgPrinting)
    .values(
      (["ja", "en"] as const).map((language) => ({
        variantId,
        language,
        listId: variantId,
        packId: "569105",
        setName: "OP-05",
        imageUrl: `https://img.test/${language}/${variantId}.png`,
      })),
    )
    .returning({ id: tcgPrinting.id });
  return en!.id;
}

let productId: number;
const price = (printingId: string, day: string, value: number, extra: Partial<typeof tcgMarketPrice.$inferInsert> = {}) =>
  db.insert(tcgMarketPrice).values({
    printingId,
    marketplace: "tcgplayer",
    condition: "NM",
    day,
    price: value,
    marketplaceProductId: productId,
    ...extra,
  });

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T23:30:00Z`));
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await truncateAll(db);
  await db.insert(tcgCard).values({ number: "OP05-119", nameEn: "Monkey.D.Luffy" });
  await db.insert(tcgArtwork).values({ variantId: "OP05-119", cardNumber: "OP05-119", variantKind: "base" });
  [{ id: productId }] = (await db
    .insert(tcgMarketplaceProduct)
    .values({ marketplace: "tcgplayer", externalId: "527024", name: "Luffy", number: "OP05-119", set: "OP05", variantId: "OP05-119", method: "rule", lastSeenOn: TODAY })
    .returning({ id: tcgMarketplaceProduct.id })) as [{ id: number }];
});

describe("tcg.market.tilePrices", () => {
  it("prices each English Printing at its latest price on or before today", async () => {
    const en = await artwork("OP05-119_p1");
    await price(en, "2026-10-20", 30);
    await price(en, "2026-10-25", 35.9);

    expect(await caller.tcg.market.tilePrices({ variantIds: ["OP05-119_p1"] })).toEqual([
      {
        printingId: en,
        variantId: "OP05-119_p1",
        language: "en",
        currency: "USD",
        price: 35.9,
        day: "2026-10-25",
        asOf: false,
        move7d: expect.closeTo(19.67, 2),
        sparkline: [
          [
            { day: "2026-10-20", price: 30 },
            { day: "2026-10-25", price: 35.9 },
          ],
        ],
      },
    ]);
  });

  it("shows no 'as of' at 7 days old and flags it at 8", async () => {
    const week = await artwork("OP05-119_p1");
    const older = await artwork("OP05-119_p2");
    await price(week, "2026-10-20", 10);
    await price(older, "2026-10-19", 12);

    const tiles = await caller.tcg.market.tilePrices({ variantIds: ["OP05-119_p1", "OP05-119_p2"] });
    expect(tiles.map((t) => [t.variantId, t.day, t.asOf])).toEqual([
      ["OP05-119_p1", "2026-10-20", false],
      ["OP05-119_p2", "2026-10-19", true],
    ]);
  });

  it("still prices at 30 days old and has no price at 31", async () => {
    const thirty = await artwork("OP05-119_p1");
    const stale = await artwork("OP05-119_p2");
    await price(thirty, "2026-09-27", 10);
    await price(stale, "2026-09-26", 12);

    const tiles = await caller.tcg.market.tilePrices({ variantIds: ["OP05-119_p1", "OP05-119_p2"] });
    expect(tiles.map((t) => [t.variantId, t.price, t.asOf])).toEqual([["OP05-119_p1", 10, true]]);
  });

  it("ignores prices after today and other Conditions, and prices only the Artworks asked for", async () => {
    const shown = await artwork("OP05-119_p1");
    const hidden = await artwork("OP05-119_p2");
    await price(shown, "2026-10-28", 99);
    await price(shown, TODAY, 5, { condition: "LP" });
    await price(hidden, TODAY, 7);

    expect(await caller.tcg.market.tilePrices({ variantIds: ["OP05-119_p1"] })).toEqual([]);
  });

  it("gives each price its 7d Price Move and a 30-day sparkline of real points", async () => {
    const en = await artwork("OP05-119_p1");
    await price(en, "2026-09-26", 99);
    await price(en, "2026-09-27", 10);
    await price(en, "2026-10-04", 12);
    await price(en, "2026-10-13", 16);
    await price(en, "2026-10-20", 20);
    await price(en, "2026-10-26", 25);

    const [tile] = await caller.tcg.market.tilePrices({ variantIds: ["OP05-119_p1"] });
    expect(tile).toMatchObject({ price: 25, day: "2026-10-26", move7d: 25 });
    expect(tile!.sparkline).toEqual([
      [
        { day: "2026-09-27", price: 10 },
        { day: "2026-10-04", price: 12 },
      ],
      [
        { day: "2026-10-13", price: 16 },
        { day: "2026-10-20", price: 20 },
        { day: "2026-10-26", price: 25 },
      ],
    ]);
  });

  it("moves 0% on a flat native price while the exchange rate swings", async () => {
    const en = await artwork("OP05-119_p1");
    await db.insert(exchangeRate).values([
      { day: "2026-10-20", currency: "USD", perEur: 1 },
      { day: TODAY, currency: "USD", perEur: 1.2 },
    ]);
    await price(en, "2026-10-20", 10);
    await price(en, TODAY, 10);

    const [tile] = await caller.tcg.market.tilePrices({ variantIds: ["OP05-119_p1"] });
    expect(tile!.move7d).toBe(0);
  });

  it("has no Price Move without a start price", async () => {
    const en = await artwork("OP05-119_p1");
    await price(en, TODAY, 10);

    const [tile] = await caller.tcg.market.tilePrices({ variantIds: ["OP05-119_p1"] });
    expect(tile).toMatchObject({ price: 10, move7d: null, sparkline: [[{ day: TODAY, price: 10 }]] });
  });
});

const none = (marketplace: string, condition: string, currency: string) => ({ marketplace, condition, currency, current: null });
const offer = (wantId: string, printingId: string, seenOn: string, value: number) => ({
  wantId,
  printingId,
  seller: "Mercari",
  price: value,
  seenOn,
});
const copy = (userId: string, printingId: string, acquiredOn: string, pricePaid: number | null) => ({
  userId,
  printingId,
  condition: "NM" as const,
  acquiredOn,
  pricePaid,
});

describe("tcg.market.printing", () => {
  let en: string;
  beforeEach(async () => {
    en = await artwork("OP05-119_p1");
  });

  it("draws a USD line per Marketplace and Condition, each day at that day's rate, broken at gaps over 7 days", async () => {
    await db.insert(exchangeRate).values([
      { day: "2026-10-20", currency: "USD", perEur: 1.1 },
      { day: "2026-10-23", currency: "USD", perEur: 1.2 },
    ]);
    await price(en, "2026-10-01", 20);
    await price(en, "2026-10-20", 30);
    await price(en, "2026-10-25", 35);
    await price(en, "2026-10-20", 10, { marketplace: "cardtrader", listingCount: 2 });
    // A Saturday: no ECB publication, so Friday's rate.
    await price(en, "2026-10-24", 10, { marketplace: "cardtrader", listingCount: 3 });
    await price(en, "2026-10-21", 8, { marketplace: "cardtrader", condition: "LP", listingCount: 1 });

    const { series } = await caller.tcg.market.printing({ printingId: en, range: "1M" });
    expect(series).toEqual([
      {
        marketplace: "tcgplayer",
        condition: "NM",
        currency: "USD",
        segments: [
          [{ day: "2026-10-01", price: 20, usd: 20 }],
          [
            { day: "2026-10-20", price: 30, usd: 30 },
            { day: "2026-10-25", price: 35, usd: 35 },
          ],
        ],
      },
      {
        marketplace: "cardtrader",
        condition: "NM",
        currency: "EUR",
        segments: [
          [
            { day: "2026-10-20", price: 10, usd: expect.closeTo(11, 6) },
            { day: "2026-10-24", price: 10, usd: expect.closeTo(12, 6) },
          ],
        ],
      },
      {
        marketplace: "cardtrader",
        condition: "LP",
        currency: "EUR",
        segments: [[{ day: "2026-10-21", price: 8, usd: expect.closeTo(8.8, 6) }]],
      },
    ]);
  });

  it("draws only the range, and offers each Condition the ranges its Marketplaces' history reaches", async () => {
    // 3M starts 2026-07-29, 1Y starts 2025-10-27.
    await db.insert(exchangeRate).values({ day: "2025-01-02", currency: "USD", perEur: 1.1 });
    await price(en, "2026-07-29", 20);
    await price(en, "2026-10-20", 30);
    await price(en, "2026-10-08", 10, { marketplace: "cardtrader" });
    await price(en, "2025-10-27", 5, { marketplace: "cardtrader", condition: "LP" });

    const month = await caller.tcg.market.printing({ printingId: en, range: "1M" });
    expect(month.series.map((s) => [s.marketplace, s.condition, s.segments.flat().map((p) => p.day)])).toEqual([
      ["tcgplayer", "NM", ["2026-10-20"]],
      ["cardtrader", "NM", ["2026-10-08"]],
    ]);
    expect(month.ranges).toEqual({
      NM: { "1M": true, "3M": true, "1Y": false, All: false },
      LP: { "1M": true, "3M": true, "1Y": true, All: true },
      MP: { "1M": true, "3M": false, "1Y": false, All: false },
      HP: { "1M": true, "3M": false, "1Y": false, All: false },
      DMG: { "1M": true, "3M": false, "1Y": false, All: false },
    });

    const all = await caller.tcg.market.printing({ printingId: en, range: "All" });
    expect(all.series.map((s) => s.segments.flat().map((p) => p.day))).toEqual([
      ["2026-07-29", "2026-10-20"],
      ["2026-10-08"],
      ["2025-10-27"],
    ]);
  });

  it("grids each Marketplace with history by Condition: Current Market Prices in native currency and USD at today's rate", async () => {
    await db.insert(exchangeRate).values([
      { day: "2026-10-01", currency: "USD", perEur: 1.1 },
      { day: "2026-10-26", currency: "USD", perEur: 1.25 },
    ]);
    await price(en, TODAY, 35.9);
    await price(en, "2026-10-20", 10, { marketplace: "cardtrader", listingCount: 3 });
    await price(en, "2026-10-19", 8, { marketplace: "cardtrader", condition: "LP", listingCount: 1 });
    await price(en, "2026-09-27", 4, { marketplace: "cardtrader", condition: "MP", listingCount: 2 });
    await price(en, "2026-09-26", 2, { marketplace: "cardtrader", condition: "HP", listingCount: 5 });

    const { grid } = await caller.tcg.market.printing({ printingId: en, range: "All" });
    expect(grid).toEqual([
      {
        marketplace: "tcgplayer",
        condition: "NM",
        currency: "USD",
        current: { price: 35.9, usd: 35.9, day: TODAY, asOf: false, listingCount: null },
      },
      none("tcgplayer", "LP", "USD"),
      none("tcgplayer", "MP", "USD"),
      none("tcgplayer", "HP", "USD"),
      none("tcgplayer", "DMG", "USD"),
      {
        marketplace: "cardtrader",
        condition: "NM",
        currency: "EUR",
        current: { price: 10, usd: 12.5, day: "2026-10-20", asOf: false, listingCount: 3 },
      },
      {
        marketplace: "cardtrader",
        condition: "LP",
        currency: "EUR",
        current: { price: 8, usd: 10, day: "2026-10-19", asOf: true, listingCount: 1 },
      },
      {
        marketplace: "cardtrader",
        condition: "MP",
        currency: "EUR",
        current: { price: 4, usd: 5, day: "2026-09-27", asOf: true, listingCount: 2 },
      },
      none("cardtrader", "HP", "EUR"),
      none("cardtrader", "DMG", "EUR"),
    ]);
  });

  it("marks only the signed-in user's Offers in the range and their Copies' prices paid", async () => {
    const other = await artwork("OP05-119_p2");
    await db.insert(user).values(
      ["user-market", "someone-else"].map((id) => ({ id, name: id, email: `${id}@test.internal` })),
    );
    const wants = await db
      .insert(tcgWant)
      .values(
        ["user-market", "someone-else"].map((userId) => ({
          userId,
          variantId: "OP05-119_p1",
          languages: ["en" as const],
          maxPrice: 50,
          minCondition: "LP" as const,
        })),
      )
      .returning({ id: tcgWant.id });
    const [mine, theirs] = wants.map((w) => w.id) as [string, string];
    await db.insert(tcgOffer).values([
      offer(mine, en, "2026-10-02", 31),
      offer(mine, en, "2026-10-20", 28.5),
      offer(mine, en, "2026-09-26", 40), // before 1M starts
      offer(mine, other, "2026-10-20", 99),
      offer(theirs, en, "2026-10-21", 25),
    ]);
    await db.insert(tcgCopy).values([
      copy("user-market", en, "2025-06-01", 22),
      copy("user-market", en, "2026-10-10", 30),
      copy("user-market", en, "2026-10-11", null), // a gift
      copy("user-market", other, "2026-10-10", 80),
      copy("someone-else", en, "2026-10-10", 18),
    ]);

    const drawer = await caller.tcg.market.printing({ printingId: en, range: "1M" });
    expect(drawer.offers).toEqual([
      { seenOn: "2026-10-02", price: 31 },
      { seenOn: "2026-10-20", price: 28.5 },
    ]);
    expect(drawer.pricesPaid).toEqual([22, 30]);
  });

  it("has an empty grid for a Printing with no Market Prices", async () => {
    expect(await caller.tcg.market.printing({ printingId: en, range: "1M" })).toMatchObject({ series: [], grid: [] });
  });
});
