/**
 * TCG Copies router (KOI-309): add a Copy directly (no Want), edit, delete, list.
 * Mocked db (helpers/mock-db): every read and write is scoped to the caller.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));

import { tcgCopy, tcgPrinting } from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { mockDb } from "./helpers/mock-db";

const USER_ID = "user-tcg";
const COPY_ID = "00000000-0000-4000-8000-0000000000c1";
const PRINTING_ID = "00000000-0000-4000-8000-0000000000a1";

const caller = () => appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);

/** The Printing lookup finds it (or, with [], doesn't). */
const printingExists = (rows: unknown[] = [{ id: PRINTING_ID }]) => mockDb.onSelect(tcgPrinting, rows);

describe("tcg.copies.create", () => {
  it("adds a Copy of a Printing for the caller, without a Want", async () => {
    printingExists();
    mockDb.onInsert(tcgCopy, [{ id: COPY_ID }]);

    await expect(
      caller().tcg.copies.create({ printingId: PRINTING_ID, condition: "NM", pricePaid: 12.5, acquiredOn: "2026-10-01" }),
    ).resolves.toEqual({ id: COPY_ID });

    expect(mockDb.inserted(tcgCopy)).toEqual([
      { userId: USER_ID, printingId: PRINTING_ID, condition: "NM", pricePaid: 12.5, acquiredOn: "2026-10-01" },
    ]);
  });

  it("rejects an unknown Printing with NOT_FOUND and writes nothing", async () => {
    printingExists([]);

    await expect(
      caller().tcg.copies.create({ printingId: PRINTING_ID, condition: "LP", acquiredOn: "2026-10-01" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDb.inserted(tcgCopy)).toEqual([]);
  });
});

describe("tcg.copies.update", () => {
  it("edits the caller's Copy, clearing the price paid", async () => {
    mockDb.onUpdate(tcgCopy, [{ id: COPY_ID }]);

    await caller().tcg.copies.update({ id: COPY_ID, condition: "MP", pricePaid: null, acquiredOn: "2026-09-30" });

    expect(mockDb.updated(tcgCopy)).toEqual([
      { set: { condition: "MP", pricePaid: null, acquiredOn: "2026-09-30" }, where: [COPY_ID, USER_ID] },
    ]);
  });

  it("rejects an edit that changes nothing", async () => {
    await expect(caller().tcg.copies.update({ id: COPY_ID })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockDb.updated(tcgCopy)).toEqual([]);
  });

  it("rejects another user's Copy with NOT_FOUND", async () => {
    mockDb.onUpdate(tcgCopy, []);

    await expect(caller().tcg.copies.update({ id: COPY_ID, condition: "HP" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("tcg.copies.delete", () => {
  it("deletes the caller's Copy", async () => {
    mockDb.onDelete(tcgCopy, [{ id: COPY_ID }]);

    await expect(caller().tcg.copies.delete({ id: COPY_ID })).resolves.toEqual({ id: COPY_ID });
    expect(mockDb.deleted(tcgCopy)).toEqual([[COPY_ID, USER_ID]]);
  });

  it("rejects another user's Copy with NOT_FOUND", async () => {
    mockDb.onDelete(tcgCopy, []);

    await expect(caller().tcg.copies.delete({ id: COPY_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("tcg.copies.list", () => {
  it("returns only the caller's Copies", async () => {
    const rows = [
      {
        id: COPY_ID,
        printingId: PRINTING_ID,
        variantId: "OP05-069_p1",
        language: "ja",
        setName: "OP-05",
        imageUrl: "https://example.test/OP05-069_p1.png",
        nameEn: "Trafalgar Law",
        nameJa: null,
        condition: "NM",
        pricePaid: 12.5,
        acquiredOn: "2026-10-01",
      },
    ];
    mockDb.onSelect(tcgCopy, rows);

    await expect(caller().tcg.copies.list()).resolves.toEqual([
      // No Market Prices queued: unpriced (Copy Value is covered on PGlite in tcg-copy-value-router.test.ts).
      { ...rows[0], belowMinimum: false, value: null, gain: null, sparkline: [] },
    ]);
    expect(mockDb.selected(tcgCopy)).toEqual([[USER_ID]]);
  });
});
