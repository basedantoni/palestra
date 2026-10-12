/**
 * TCG Offers (KOI-310): create, validate the Printing against the Want, edit,
 * delete, and the Wants list's cheapest Offer and buyable flag. Scoped to the
 * caller through the Offer's Want.
 *
 * Mocked db (helpers/mock-db): selects are answered per table; writes are
 * recorded so tests assert on rows written and WHERE params.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));

import { tcgOffer, tcgPrinting, tcgWant } from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { mockDb } from "./helpers/mock-db";

const USER_ID = "user-offers";
const WANT_ID = "00000000-0000-4000-8000-0000000000d1";
const OFFER_ID = "00000000-0000-4000-8000-0000000000e1";
const JA_PRINTING = "00000000-0000-4000-8000-0000000000a1";
const EN_PRINTING = "00000000-0000-4000-8000-0000000000a2";

const caller = () => appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);

/** The caller's Want, as the ownership lookup finds it. */
const wantIs = (languages: string[], variantId = "OP05-069_p1") => mockDb.onSelect(tcgWant, [{ variantId, languages }]);
/** The chosen Printing. */
const printingIs = (language: string, variantId = "OP05-069_p1") =>
  mockDb.onSelect(tcgPrinting, [{ variantId, language }]);

const terms = { printingId: JA_PRINTING, seller: "Card Rush", price: 18.4, seenOn: "2026-10-10" };

describe("tcg.offers.create", () => {
  it("records an Offer for a Printing of the Want's Artwork", async () => {
    wantIs(["ja", "en"]);
    printingIs("ja");
    mockDb.onInsert(tcgOffer, [{ id: OFFER_ID }]);

    const result = await caller().tcg.offers.create({
      wantId: WANT_ID,
      ...terms,
      url: "https://www.cardrush-op.jp/product/1",
    });

    expect(result).toEqual({ id: OFFER_ID });
    expect(mockDb.selected(tcgWant)).toEqual([[WANT_ID, USER_ID]]);
    expect(mockDb.inserted(tcgOffer)).toEqual([
      {
        wantId: WANT_ID,
        printingId: JA_PRINTING,
        seller: "Card Rush",
        price: 18.4,
        url: "https://www.cardrush-op.jp/product/1",
        seenOn: "2026-10-10",
      },
    ]);
  });

  it("stores no URL when none is given", async () => {
    wantIs(["en"]);
    printingIs("en");
    mockDb.onInsert(tcgOffer, [{ id: OFFER_ID }]);

    await caller().tcg.offers.create({ wantId: WANT_ID, ...terms, printingId: EN_PRINTING });

    expect(mockDb.inserted(tcgOffer)).toEqual([expect.objectContaining({ printingId: EN_PRINTING, url: null })]);
  });

  it("rejects a Printing of another Artwork", async () => {
    wantIs(["ja", "en"], "OP05-069_p1");
    printingIs("ja", "OP05-069");

    await expect(caller().tcg.offers.create({ wantId: WANT_ID, ...terms })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/another Artwork/),
    });
    expect(mockDb.inserted(tcgOffer)).toEqual([]);
  });

  it("rejects a Printing in a language the Want doesn't accept", async () => {
    wantIs(["en"]);
    printingIs("ja");

    await expect(caller().tcg.offers.create({ wantId: WANT_ID, ...terms })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/Japanese/),
    });
    expect(mockDb.inserted(tcgOffer)).toEqual([]);
  });

  it("rejects an unknown Printing", async () => {
    wantIs(["ja"]);
    mockDb.onSelect(tcgPrinting, []);

    await expect(caller().tcg.offers.create({ wantId: WANT_ID, ...terms })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockDb.inserted(tcgOffer)).toEqual([]);
  });

  it("rejects another user's Want with NOT_FOUND", async () => {
    mockDb.onSelect(tcgWant, []);

    await expect(caller().tcg.offers.create({ wantId: WANT_ID, ...terms })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockDb.selected(tcgWant)).toEqual([[WANT_ID, USER_ID]]);
    expect(mockDb.inserted(tcgOffer)).toEqual([]);
  });

  it.each([
    ["a blank seller", { seller: "  " }],
    ["a zero price", { price: 0 }],
    ["a malformed date", { seenOn: "10/10/2026" }],
    ["a malformed URL", { url: "not a url" }],
  ])("rejects %s", async (_, bad) => {
    await expect(caller().tcg.offers.create({ wantId: WANT_ID, ...terms, ...bad })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mockDb.inserted(tcgOffer)).toEqual([]);
  });
});

/** The caller's Offer, as the ownership lookup (through its Want) finds it. */
const offerIs = (languages: string[], variantId = "OP05-069_p1") =>
  mockDb.onSelect(tcgOffer, [{ variantId, languages }]);

describe("tcg.offers.update", () => {
  it("edits the caller's Offer", async () => {
    offerIs(["ja", "en"]);
    printingIs("en");
    mockDb.onUpdate(tcgOffer, [{ id: OFFER_ID }]);

    await caller().tcg.offers.update({ id: OFFER_ID, ...terms, printingId: EN_PRINTING, price: 21, url: null });

    expect(mockDb.selected(tcgOffer)).toEqual([[OFFER_ID, USER_ID]]);
    expect(mockDb.updated(tcgOffer)).toEqual([
      {
        set: { printingId: EN_PRINTING, seller: "Card Rush", price: 21, url: null, seenOn: "2026-10-10" },
        where: [OFFER_ID],
      },
    ]);
  });

  it("rejects switching to a Printing in a language the Want doesn't accept", async () => {
    offerIs(["ja"]);
    printingIs("en");

    await expect(
      caller().tcg.offers.update({ id: OFFER_ID, ...terms, printingId: EN_PRINTING }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/English/) });
    expect(mockDb.updated(tcgOffer)).toEqual([]);
  });

  it("rejects another user's Offer with NOT_FOUND", async () => {
    mockDb.onSelect(tcgOffer, []);

    await expect(caller().tcg.offers.update({ id: OFFER_ID, ...terms })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockDb.updated(tcgOffer)).toEqual([]);
  });
});

describe("tcg.offers.delete", () => {
  it("deletes the caller's Offer", async () => {
    offerIs(["ja"]);
    mockDb.onDelete(tcgOffer, [{ id: OFFER_ID }]);

    await expect(caller().tcg.offers.delete({ id: OFFER_ID })).resolves.toEqual({ id: OFFER_ID });
    expect(mockDb.selected(tcgOffer)).toEqual([[OFFER_ID, USER_ID]]);
    expect(mockDb.deleted(tcgOffer)).toEqual([[OFFER_ID]]);
  });

  it("rejects another user's Offer with NOT_FOUND", async () => {
    mockDb.onSelect(tcgOffer, []);

    await expect(caller().tcg.offers.delete({ id: OFFER_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDb.deleted(tcgOffer)).toEqual([]);
  });
});

const want = (id: string, variantId: string, languages: string[], maxPrice: number) => ({
  id,
  variantId,
  languages,
  maxPrice,
  status: "open",
});
const offer = (id: string, wantId: string, language: string, price: number) => ({
  id,
  wantId,
  printingId: language === "ja" ? JA_PRINTING : EN_PRINTING,
  language,
  setName: "OP-05",
  seller: `seller ${id}`,
  price,
  url: null,
  seenOn: "2026-10-01",
});

describe("tcg.wants.list with Offers", () => {
  const W1 = "00000000-0000-4000-8000-0000000000d1";
  const W2 = "00000000-0000-4000-8000-0000000000d2";
  const W3 = "00000000-0000-4000-8000-0000000000d3";
  const W4 = "00000000-0000-4000-8000-0000000000d4";
  const { wantId: _w1, ...mercariEn } = offer("o-en", W1, "en", 18);
  const { wantId: _w2, ...shopJa } = offer("o-ja", W1, "ja", 25);

  it("compares each Want's Offers, cheapest first, and flags Wants buyable at or under their max", async () => {
    mockDb.onSelect(tcgWant, [
      want(W1, "OP05-069_p1", ["ja", "en"], 20), // cheapest 18 (EN) under max
      want(W2, "OP05-119", ["en"], 30), // cheapest exactly max
      want(W3, "OP01-001", ["ja"], 10), // cheapest over max
      want(W4, "ST01-012", ["ja"], 10), // no Offers
    ]);
    mockDb.onSelect(tcgOffer, [
      offer("o-ja", W1, "ja", 25),
      offer("o-en", W1, "en", 18),
      offer("o-w2", W2, "en", 30),
      offer("o-w3", W3, "ja", 10.01),
    ]);

    const rows = await caller().tcg.wants.list();

    expect(mockDb.selected(tcgOffer)).toEqual([[W1, W2, W3, W4]]);
    expect(rows.map((r) => [r.id, r.cheapest?.id ?? null, r.buyable])).toEqual([
      [W1, "o-en", true],
      [W2, "o-w2", true],
      [W3, "o-w3", false],
      [W4, null, false],
    ]);
    expect(rows[0]!.offers).toEqual([mercariEn, shopJa]);
    expect(rows[0]!.cheapest).toEqual(mercariEn);
  });

  it("offers only the Printings in the Want's accepted languages", async () => {
    mockDb.onSelect(tcgWant, [want(W1, "OP05-069_p1", ["en"], 20)]);
    mockDb.onSelect(tcgPrinting, [
      { id: JA_PRINTING, variantId: "OP05-069_p1", language: "ja", setName: "OP-05" },
      { id: EN_PRINTING, variantId: "OP05-069_p1", language: "en", setName: "OP-05" },
    ]);

    const [row] = await caller().tcg.wants.list();

    expect(row!.printings).toEqual([{ id: EN_PRINTING, language: "en", setName: "OP-05" }]);
  });
});
