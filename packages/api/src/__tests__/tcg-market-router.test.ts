/**
 * Tile prices (KOI-366, KOI-367): each shown Artwork's English Printing priced at its Current Market
 * Price, the latest TCGplayer NM price on or before today (UTC), at most 30 days old and flagged
 * "as of" once older than 7 days, with its 7d Price Move and 30-day sparkline. Real SQL (PGlite).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import { exchangeRate, tcgArtwork, tcgCard, tcgMarketPrice, tcgMarketplaceProduct, tcgPrinting } from "@life-tracker/db/schema/index";

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
