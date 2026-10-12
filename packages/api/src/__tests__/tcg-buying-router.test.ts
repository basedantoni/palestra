/**
 * TCG buying flow (KOI-311): an Offer bought moves its Want open → ordered,
 * cancelling returns it to open, receiving creates one Copy and fulfils it.
 * Every other transition is rejected; fulfilled is terminal.
 *
 * Mocked db (helpers/mock-db): selects are answered per table; writes are
 * recorded so tests assert on rows written and WHERE params.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));

import { tcgCopy, tcgOffer, tcgWant } from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { mockDb } from "./helpers/mock-db";

const USER_ID = "user-buying";
const WANT_ID = "00000000-0000-4000-8000-0000000000d1";
const OFFER_ID = "00000000-0000-4000-8000-0000000000e1";

const caller = () => appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);

/** The caller's Want, as the ownership lookup finds it. */
const wantIs = (status: string) => mockDb.onSelect(tcgWant, [{ status }]);

describe("tcg.wants.buy (open → ordered)", () => {
  it("orders an open Want and records the bought Offer", async () => {
    mockDb.onSelect(tcgOffer, [{ id: OFFER_ID }]);
    wantIs("open");
    mockDb.onUpdate(tcgWant, [{ id: WANT_ID, boughtOfferId: OFFER_ID }]);

    await caller().tcg.wants.buy({ id: WANT_ID, offerId: OFFER_ID });

    // The Offer is looked up as one of this Want's, owned by the caller.
    expect(mockDb.selected(tcgOffer)).toEqual([[OFFER_ID, WANT_ID, USER_ID]]);
    expect(mockDb.updated(tcgWant)).toEqual([
      { set: { status: "ordered", boughtOfferId: OFFER_ID }, where: [WANT_ID, USER_ID, "open"] },
    ]);
  });

  it("rejects an Offer that isn't this Want's (another Want's, or another user's)", async () => {
    mockDb.onSelect(tcgOffer, []);

    await expect(caller().tcg.wants.buy({ id: WANT_ID, offerId: OFFER_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockDb.updated(tcgWant)).toEqual([]);
  });

  it.each(["ordered", "fulfilled", "dropped"])("rejects buying for a %s Want", async (status) => {
    mockDb.onSelect(tcgOffer, [{ id: OFFER_ID }]);
    wantIs(status);

    await expect(caller().tcg.wants.buy({ id: WANT_ID, offerId: OFFER_ID })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mockDb.updated(tcgWant)).toEqual([]);
  });
});

describe("received below the minimum Condition", () => {
  it("is surfaced on fulfilled Wants", async () => {
    const want = { variantId: "OP05-069_p1", languages: ["ja"], maxPrice: 20, minCondition: "LP", status: "fulfilled" };
    mockDb.onSelect(tcgWant, [
      { ...want, id: "w-below", receivedCondition: "MP" },
      { ...want, id: "w-at", receivedCondition: "LP" },
      { ...want, id: "w-above", receivedCondition: "NM" },
    ]);

    const wants = await caller().tcg.wants.list({ status: "fulfilled" });

    expect(wants.map((w) => [w.id, w.belowMinimum])).toEqual([
      ["w-below", true],
      ["w-at", false],
      ["w-above", false],
    ]);
  });

  it("is surfaced on the Copy it created, not on Copies added directly", async () => {
    mockDb.onSelect(tcgCopy, [
      { id: "c-below", condition: "HP", minCondition: "MP" },
      { id: "c-ok", condition: "NM", minCondition: "MP" },
      { id: "c-direct", condition: "DMG", minCondition: null },
    ]);

    await expect(caller().tcg.copies.list()).resolves.toEqual([
      { id: "c-below", condition: "HP", belowMinimum: true },
      { id: "c-ok", condition: "NM", belowMinimum: false },
      { id: "c-direct", condition: "DMG", belowMinimum: false },
    ]);
  });
});

describe("tcg.offers.delete of a bought Offer", () => {
  it("refuses to delete the Offer a Want was bought from", async () => {
    mockDb.onSelect(tcgOffer, [
      { variantId: "OP05-069_p1", languages: ["ja"], status: "ordered", boughtOfferId: OFFER_ID },
    ]);

    await expect(caller().tcg.offers.delete({ id: OFFER_ID })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockDb.deleted(tcgOffer)).toEqual([]);
  });

  it("keeps an ordered Want's other Offers too: Offers change only while the Want is open", async () => {
    const OTHER_OFFER = "00000000-0000-4000-8000-0000000000e2";
    mockDb.onSelect(tcgOffer, [
      { variantId: "OP05-069_p1", languages: ["ja"], status: "ordered", boughtOfferId: OFFER_ID },
    ]);

    await expect(caller().tcg.offers.delete({ id: OTHER_OFFER })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockDb.deleted(tcgOffer)).toEqual([]);
  });
});

describe("tcg.wants.cancelOrder (ordered → open)", () => {
  it("reopens an ordered Want and clears the bought Offer", async () => {
    wantIs("ordered");
    mockDb.onUpdate(tcgWant, [{ id: WANT_ID, boughtOfferId: null }]);

    await caller().tcg.wants.cancelOrder({ id: WANT_ID });

    expect(mockDb.selected(tcgWant)).toEqual([[WANT_ID, USER_ID]]);
    expect(mockDb.updated(tcgWant)).toEqual([
      { set: { status: "open", boughtOfferId: null }, where: [WANT_ID, USER_ID, "ordered"] },
    ]);
  });

  it.each(["open", "fulfilled", "dropped"])("rejects cancelling a %s Want", async (status) => {
    wantIs(status);

    await expect(caller().tcg.wants.cancelOrder({ id: WANT_ID })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockDb.updated(tcgWant)).toEqual([]);
  });

  it("rejects another user's Want with NOT_FOUND", async () => {
    mockDb.onSelect(tcgWant, []);

    await expect(caller().tcg.wants.cancelOrder({ id: WANT_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDb.updated(tcgWant)).toEqual([]);
  });
});

describe("tcg.wants.receive (ordered → fulfilled)", () => {
  const PRINTING_ID = "00000000-0000-4000-8000-0000000000f1";
  const COPY_ID = "00000000-0000-4000-8000-0000000000c1";

  /** An ordered Want whose bought Offer is a $18.50 Printing. */
  function orderedWant() {
    wantIs("ordered");
    mockDb.onUpdate(tcgWant, [{ id: WANT_ID, boughtOfferId: OFFER_ID }]);
    mockDb.onSelect(tcgOffer, [{ printingId: PRINTING_ID, price: 18.5 }]);
    mockDb.onInsert(tcgCopy, [{ id: COPY_ID }]);
  }

  it("fulfils the Want and creates one Copy of the bought Printing, price paid prefilled from the Offer", async () => {
    orderedWant();

    const result = await caller().tcg.wants.receive({ id: WANT_ID, condition: "LP", acquiredOn: "2026-10-11" });

    expect(result).toEqual({ id: WANT_ID, copyId: COPY_ID });
    expect(mockDb.updated(tcgWant)).toEqual([{ set: { status: "fulfilled" }, where: [WANT_ID, USER_ID, "ordered"] }]);
    expect(mockDb.selected(tcgOffer)).toEqual([[OFFER_ID]]);
    expect(mockDb.inserted(tcgCopy)).toEqual([
      {
        userId: USER_ID,
        printingId: PRINTING_ID,
        condition: "LP",
        pricePaid: 18.5,
        acquiredOn: "2026-10-11",
        wantId: WANT_ID,
      },
    ]);
  });

  it("takes an edited price paid over the Offer's", async () => {
    orderedWant();

    await caller().tcg.wants.receive({ id: WANT_ID, condition: "NM", pricePaid: 21.07, acquiredOn: "2026-10-11" });

    expect(mockDb.inserted(tcgCopy)).toMatchObject([{ pricePaid: 21.07, condition: "NM" }]);
  });

  it.each(["open", "fulfilled", "dropped"])("rejects receiving a %s Want and creates no Copy", async (status) => {
    wantIs(status);

    await expect(
      caller().tcg.wants.receive({ id: WANT_ID, condition: "NM", acquiredOn: "2026-10-11" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockDb.updated(tcgWant)).toEqual([]);
    expect(mockDb.inserted(tcgCopy)).toEqual([]);
  });

  it("rejects another user's Want with NOT_FOUND and creates no Copy", async () => {
    mockDb.onSelect(tcgWant, []);

    await expect(
      caller().tcg.wants.receive({ id: WANT_ID, condition: "NM", acquiredOn: "2026-10-11" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDb.selected(tcgWant)).toEqual([[WANT_ID, USER_ID]]);
    expect(mockDb.inserted(tcgCopy)).toEqual([]);
  });
});
