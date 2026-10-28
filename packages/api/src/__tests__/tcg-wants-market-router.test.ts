/**
 * Market Prices on Wants and Offers (KOI-373): each accepted language's NM Current Market Price in
 * USD with its 30-day range, and each Offer against today's NM Current Market Price for its Printing at today's
 * rate. Real SQL (PGlite).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import {
  exchangeRate,
  tcgArtwork,
  tcgCard,
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
const USER_ID = "user-wants-market";
const caller = appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);

type Language = "ja" | "en" | "ko";
let product: Record<"tcgplayer" | "cardtrader", number>;

/** An Artwork of OP05-119 with a Printing per language; returns their ids by language. */
async function artwork(variantId: string, languages: Language[] = ["ja", "en", "ko"]) {
  await db.insert(tcgArtwork).values({ variantId, cardNumber: "OP05-119", variantKind: "parallel" });
  const rows = await db
    .insert(tcgPrinting)
    .values(
      languages.map((language) => ({
        variantId,
        language,
        listId: `${variantId}-${language}`,
        packId: "569105",
        setName: "OP-05",
        imageUrl: `https://img.test/${language}/${variantId}.png`,
      })),
    )
    .returning({ id: tcgPrinting.id, language: tcgPrinting.language });
  return Object.fromEntries(rows.map((r) => [r.language, r.id])) as Record<Language, string>;
}

/** A Market Price: English from TCGplayer in USD, others from CardTrader in EUR. */
const price = (printingId: string, language: Language, day: string, value: number, condition: "NM" | "LP" = "NM") => {
  const marketplace = language === "en" ? "tcgplayer" : "cardtrader";
  return db.insert(tcgMarketPrice).values({
    printingId,
    marketplace,
    condition,
    day,
    price: value,
    marketplaceProductId: product[marketplace],
  });
};

async function want(variantId: string, languages: Language[], minCondition: "NM" | "LP" = "NM") {
  const [row] = await db
    .insert(tcgWant)
    .values({ userId: USER_ID, variantId, languages, maxPrice: 100, minCondition })
    .returning({ id: tcgWant.id });
  return row!.id;
}

const offer = (wantId: string, printingId: string, value: number, seenOn: string) =>
  db.insert(tcgOffer).values({ wantId, printingId, seller: "Shop", price: value, seenOn });

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T23:30:00Z`));
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await truncateAll(db);
  await db.insert(user).values({ id: USER_ID, name: USER_ID, email: `${USER_ID}@test.internal` });
  await db.insert(tcgCard).values({ number: "OP05-119", nameEn: "Monkey.D.Luffy" });
  const products = await db
    .insert(tcgMarketplaceProduct)
    .values(
      (["tcgplayer", "cardtrader"] as const).map((marketplace) => ({
        marketplace,
        externalId: "1",
        name: "Luffy",
        number: "OP05-119",
        set: "OP05",
        method: "rule" as const,
        lastSeenOn: TODAY,
      })),
    )
    .returning({ id: tcgMarketplaceProduct.id, marketplace: tcgMarketplaceProduct.marketplace });
  product = Object.fromEntries(products.map((p) => [p.marketplace, p.id])) as typeof product;
  // The euro was worth $1 a week ago and $1.25 now.
  await db.insert(exchangeRate).values([
    { day: "2026-10-20", currency: "USD", perEur: 1 },
    { day: "2026-10-26", currency: "USD", perEur: 1.25 },
  ]);
});

describe("tcg.wants.list market prices", () => {
  it("shows each accepted language's NM Current Market Price in USD and 30-day range, none where unpriced", async () => {
    const p = await artwork("OP05-119_p1");
    await want("OP05-119_p1", ["en", "ja"]);
    await price(p.en, "en", "2026-09-26", 99);
    await price(p.en, "en", "2026-10-01", 20);
    await price(p.en, "en", "2026-10-20", 30);
    await price(p.en, "en", "2026-10-26", 25);
    await price(p.en, "en", TODAY, 1, "LP");
    await price(p.ko, "ko", TODAY, 7);

    const [w] = await caller.tcg.wants.list();
    expect(w!.market).toEqual([
      { language: "en", printingId: p.en, current: { price: 25, day: "2026-10-26", asOf: false, low: 20, high: 30 } },
      { language: "ja", printingId: p.ja, current: null },
    ]);
  });

  it("converts a CardTrader price and its range at today's rate", async () => {
    const p = await artwork("OP05-119_p1");
    await want("OP05-119_p1", ["ja"]);
    await price(p.ja, "ja", "2026-10-20", 32);
    await price(p.ja, "ja", "2026-10-26", 40);

    const [w] = await caller.tcg.wants.list();
    expect(w!.market).toEqual([
      { language: "ja", printingId: p.ja, current: { price: 50, day: "2026-10-26", asOf: false, low: 40, high: 50 } },
    ]);
  });

  it("compares each Offer with today's NM Current Market Price for its language at today's rate, whatever the minimum Condition", async () => {
    const p = await artwork("OP05-119_p1");
    const id = await want("OP05-119_p1", ["en", "ja"], "LP");
    await price(p.ja, "ja", "2026-10-20", 40);
    await price(p.ja, "ja", "2026-10-26", 40);
    await price(p.ja, "ja", "2026-10-26", 20, "LP");
    await price(p.en, "en", "2026-10-26", 25);
    await price(p.en, "en", "2026-10-26", 10, "LP");
    // Seen 7 days ago (at a $1 euro): compared with today's Current Market Price, $50; not muted.
    await offer(id, p.ja, 60, "2026-10-20");
    // Seen 8 days ago: muted.
    await offer(id, p.en, 20, "2026-10-19");

    const [w] = await caller.tcg.wants.list();
    expect(w!.offers.map((o) => [o.language, o.vsMarket])).toEqual([
      ["en", { percent: expect.closeTo(-20, 9), stale: true }],
      ["ja", { percent: expect.closeTo(20, 9), stale: false }],
    ]);
  });

  it("has no comparison without a Current Market Price, and one against an 'as of' price", async () => {
    const p = await artwork("OP05-119_p1");
    const id = await want("OP05-119_p1", ["en", "ja"]);
    await price(p.en, "en", "2026-10-15", 10);
    await price(p.ja, "ja", "2026-09-20", 10);
    await offer(id, p.en, 11, TODAY);
    await offer(id, p.ja, 12, TODAY);

    const [w] = await caller.tcg.wants.list();
    expect(w!.market[0]!.current).toMatchObject({ price: 10, asOf: true });
    expect(w!.offers.map((o) => [o.language, o.vsMarket])).toEqual([
      ["en", { percent: expect.closeTo(10, 9), stale: false }],
      ["ja", null],
    ]);
  });

  it("pictures the Want with its first accepted Printing, Japanese first, for the drawer to open", async () => {
    const both = await artwork("OP05-119_p1");
    const english = await artwork("OP05-119_p2");
    const unprinted = await artwork("OP05-119_p3", ["ja"]);
    await want("OP05-119_p1", ["en", "ja"]);
    await want("OP05-119_p2", ["en"]);
    await want("OP05-119_p3", ["en"]);

    const wants = await caller.tcg.wants.list();
    expect(
      wants
        .map((w) => [w.variantId, w.pictured, w.imageUrl])
        .toSorted(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ["OP05-119_p1", { printingId: both.ja, language: "ja" }, "https://img.test/ja/OP05-119_p1.png"],
      ["OP05-119_p2", { printingId: english.en, language: "en" }, "https://img.test/en/OP05-119_p2.png"],
      // No accepted Printing yet: any Printing of the Artwork.
      ["OP05-119_p3", { printingId: unprinted.ja, language: "ja" }, "https://img.test/ja/OP05-119_p3.png"],
    ]);
  });
});
