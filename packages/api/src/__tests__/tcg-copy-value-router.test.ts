/**
 * Copy Value, Gain and Collection Value (KOI-374): each Copy priced at the lowest Current Market
 * Price at its Condition or better on its language's Marketplace, in USD at that day's ECB rate; the
 * collection's total, coverage and Gain; and its history, today's Copies at past days' prices.
 * Real SQL (PGlite).
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
  tcgPrinting,
  user,
} from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { truncateAll } from "./helpers/pglite";

const TODAY = "2026-10-27";
const ME = "user-copy-value";
const caller = appRouter.createCaller({ session: { user: { id: ME } } } as any);

type Condition = "NM" | "LP" | "MP" | "HP" | "DMG";
let printings: { en: string; ja: string };
let productId: number;

const price = (printingId: string, day: string, value: number, condition: Condition = "NM") =>
  db.insert(tcgMarketPrice).values({
    printingId,
    marketplace: printingId === printings.en ? "tcgplayer" : "cardtrader",
    condition,
    day,
    price: value,
    marketplaceProductId: productId,
  });
const addCopy = (printingId: string, condition: Condition, pricePaid: number | null, userId = ME) =>
  db.insert(tcgCopy).values({ userId, printingId, condition, pricePaid, acquiredOn: "2026-10-01" });
const usdPerEur = (day: string, perEur: number) => db.insert(exchangeRate).values({ day, currency: "USD", perEur });

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T23:30:00Z`));
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await truncateAll(db);
  await db.insert(user).values([ME, "someone-else"].map((id) => ({ id, name: id, email: `${id}@test.internal` })));
  await db.insert(tcgCard).values({ number: "OP05-119", nameEn: "Monkey.D.Luffy" });
  await db.insert(tcgArtwork).values({ variantId: "OP05-119_p1", cardNumber: "OP05-119", variantKind: "parallel" });
  const [ja, en] = await db
    .insert(tcgPrinting)
    .values(
      (["ja", "en"] as const).map((language) => ({
        variantId: "OP05-119_p1",
        language,
        listId: "OP05-119_p1",
        packId: "569105",
        setName: "OP-05",
        imageUrl: `https://img.test/${language}.png`,
      })),
    )
    .returning({ id: tcgPrinting.id });
  printings = { ja: ja!.id, en: en!.id };
  [{ id: productId }] = (await db
    .insert(tcgMarketplaceProduct)
    .values({ marketplace: "tcgplayer", externalId: "527024", name: "Luffy", number: "OP05-119", set: "OP05", variantId: "OP05-119_p1", method: "rule", lastSeenOn: TODAY })
    .returning({ id: tcgMarketplaceProduct.id })) as [{ id: number }];
});

describe("tcg.copies.list Copy Value", () => {
  it("prices an English LP Copy at the TCGplayer NM price, 'priced at NM', with its Gain and sparkline", async () => {
    await addCopy(printings.en, "LP", 20);
    await price(printings.en, "2026-10-25", 30);
    await price(printings.en, TODAY, 32);

    const [copy] = await caller.tcg.copies.list();
    expect(copy).toMatchObject({
      value: { usd: 32, pricedAt: "NM", day: TODAY, asOf: false },
      gain: 12,
      sparkline: [
        [
          { day: "2026-10-25", price: 30 },
          { day: "2026-10-26", price: 30 },
          { day: TODAY, price: 32 },
        ],
      ],
    });
  });

  it("prices a Japanese MP Copy at the lowest CardTrader MP, LP or NM price, in USD at today's rate", async () => {
    await addCopy(printings.ja, "MP", null);
    await usdPerEur("2026-10-26", 1.25);
    await price(printings.ja, TODAY, 40, "NM");
    await price(printings.ja, TODAY, 16, "LP");
    await price(printings.ja, TODAY, 20, "MP");
    await price(printings.ja, TODAY, 2, "HP");
    // English is never a Japanese Copy's price.
    await price(printings.en, TODAY, 1, "NM");

    const [copy] = await caller.tcg.copies.list();
    expect(copy).toMatchObject({ value: { usd: 20, pricedAt: "LP", day: TODAY, asOf: false }, gain: null });
  });

  it("leaves a Copy with no price at its Condition or better unpriced", async () => {
    await addCopy(printings.ja, "LP", 10);
    await usdPerEur(TODAY, 1);
    await price(printings.ja, TODAY, 2, "MP");

    const [copy] = await caller.tcg.copies.list();
    expect(copy).toMatchObject({ value: null, gain: null, sparkline: [] });
  });

  it("keeps the Copy's own Condition on a tie, and leaves a CardTrader price unpriced with no dollar rate", async () => {
    await addCopy(printings.en, "LP", null);
    await addCopy(printings.ja, "NM", null);
    await price(printings.en, TODAY, 30, "NM");
    await price(printings.en, TODAY, 30, "LP");
    await price(printings.ja, TODAY, 40, "NM");

    const copies = await caller.tcg.copies.list();
    expect(copies.map((c) => [c.language, c.value?.pricedAt ?? null])).toEqual(
      expect.arrayContaining([
        ["en", "LP"],
        ["ja", null],
      ]),
    );
  });

  it("flags a price over 7 days old 'as of' and leaves one over 30 days unpriced", async () => {
    await addCopy(printings.en, "NM", null);
    await addCopy(printings.ja, "NM", null);
    await usdPerEur("2026-09-01", 1);
    await price(printings.en, "2026-10-19", 30);
    await price(printings.ja, "2026-09-26", 30);

    const copies = await caller.tcg.copies.list();
    expect(copies.map((c) => [c.language, c.value])).toEqual(
      expect.arrayContaining([
        ["en", { usd: 30, pricedAt: "NM", day: "2026-10-19", asOf: true }],
        ["ja", null],
      ]),
    );
  });
});

describe("tcg.market.collectionHistory", () => {
  it("totals priced Copy Values with coverage, and Gain over Copies with both a value and a price paid", async () => {
    await usdPerEur(TODAY, 1);
    await price(printings.en, TODAY, 30);
    await price(printings.ja, TODAY, 50, "LP");
    await addCopy(printings.en, "NM", 20); // +10
    await addCopy(printings.en, "LP", 40); // -10, priced at NM
    await addCopy(printings.ja, "LP", 30); // +20
    await addCopy(printings.ja, "NM", 25); // unpriced: no NM price
    await addCopy(printings.en, "NM", null); // a pack pull
    await addCopy(printings.en, "NM", 1, "someone-else");

    const collection = await caller.tcg.market.collectionHistory({ range: "1M" });
    expect(collection).toMatchObject({
      today: TODAY,
      copies: 5,
      value: { day: TODAY, usd: 140, priced: 4 },
      gain: { usd: 20, percent: expect.closeTo(22.22, 2), copies: 3 },
    });
  });

  it("revalues today's Copies at each past day's prices, so adding a Copy changes every past day equally", async () => {
    await usdPerEur("2026-10-20", 1);
    await price(printings.en, "2026-10-25", 30);
    await price(printings.en, TODAY, 35);
    await price(printings.ja, "2026-10-25", 10);
    await addCopy(printings.en, "NM", 20);

    const before = await caller.tcg.market.collectionHistory({ range: "1M" });
    expect(before.points).toEqual([
      { day: "2026-10-25", usd: 30, priced: 1 },
      { day: "2026-10-26", usd: 30, priced: 1 },
      { day: TODAY, usd: 35, priced: 1 },
    ]);

    await addCopy(printings.ja, "NM", 5);
    const after = await caller.tcg.market.collectionHistory({ range: "1M" });
    expect(after.points).toEqual([
      { day: "2026-10-25", usd: 40, priced: 2 },
      { day: "2026-10-26", usd: 40, priced: 2 },
      { day: TODAY, usd: 45, priced: 2 },
    ]);
    // All starts at the first Market Price.
    expect((await caller.tcg.market.collectionHistory({ range: "All" })).points).toEqual(after.points);
  });

  it("counts an exchange-rate swing: a flat EUR price is worth double once the euro doubles", async () => {
    await usdPerEur("2026-10-20", 1);
    await usdPerEur("2026-10-26", 2);
    await price(printings.ja, "2026-10-25", 10);
    await addCopy(printings.ja, "NM", 5);

    expect((await caller.tcg.market.collectionHistory({ range: "1M" })).points).toEqual([
      { day: "2026-10-25", usd: 10, priced: 1 },
      { day: "2026-10-26", usd: 20, priced: 1 },
      { day: TODAY, usd: 20, priced: 1 },
    ]);
  });

  it("has no value or Gain with nothing priced", async () => {
    await addCopy(printings.en, "NM", 20);

    expect(await caller.tcg.market.collectionHistory({ range: "All" })).toEqual({
      today: TODAY,
      copies: 1,
      value: null,
      gain: null,
      points: [],
    });
  });
});
