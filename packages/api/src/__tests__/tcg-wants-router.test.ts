/**
 * TCG Wants (KOI-308): create, edit, drop/reopen, scoped to the caller.
 *
 * Mocked db (helpers/mock-db): selects are answered per table; writes are
 * recorded so tests assert on rows written and WHERE params.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));

import { tcgArtwork, tcgWant } from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { mockDb } from "./helpers/mock-db";

const USER_ID = "user-wants";
const WANT_ID = "00000000-0000-4000-8000-0000000000d1";

const caller = () => appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);

describe("tcg.wants.list", () => {
  it("lists the caller's Wants in one status, open by default", async () => {
    const rows = [{ id: WANT_ID, variantId: "OP05-069_p1", status: "open" }];
    mockDb.onSelect(tcgWant, rows, []);

    await expect(caller().tcg.wants.list()).resolves.toEqual(rows);
    await expect(caller().tcg.wants.list({ status: "dropped" })).resolves.toEqual([]);
    expect(mockDb.selected(tcgWant)).toEqual([
      [USER_ID, "open"],
      [USER_ID, "dropped"],
    ]);
  });
});

describe("tcg.wants.create", () => {
  it("creates an open Want for an Artwork", async () => {
    mockDb.onSelect(tcgArtwork, [{ variantId: "OP05-069_p1" }]);
    mockDb.onInsert(tcgWant, [{ id: WANT_ID }]);

    const result = await caller().tcg.wants.create({
      variantId: "OP05-069_p1",
      languages: ["ja", "en"],
      maxPrice: 42.5,
      minCondition: "LP",
    });

    expect(result).toEqual({ id: WANT_ID });
    expect(mockDb.inserted(tcgWant)).toEqual([
      {
        userId: USER_ID,
        variantId: "OP05-069_p1",
        languages: ["ja", "en"],
        maxPrice: 42.5,
        minCondition: "LP",
        status: "open",
      },
    ]);
  });

  it("rejects an unknown Artwork", async () => {
    mockDb.onSelect(tcgArtwork, []);

    await expect(
      caller().tcg.wants.create({ variantId: "NOPE-001", languages: ["ja"], maxPrice: 10, minCondition: "NM" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDb.inserted(tcgWant)).toEqual([]);
  });
});

describe("tcg.wants.update", () => {
  it("edits price, languages, and minimum Condition of the caller's Want", async () => {
    mockDb.onUpdate(tcgWant, [{ id: WANT_ID }]);

    await caller().tcg.wants.update({ id: WANT_ID, languages: ["en"], maxPrice: 30, minCondition: "MP" });

    expect(mockDb.updated(tcgWant)).toEqual([
      { set: { languages: ["en"], maxPrice: 30, minCondition: "MP" }, where: [WANT_ID, USER_ID] },
    ]);
  });

  it("rejects another user's Want with NOT_FOUND", async () => {
    mockDb.onUpdate(tcgWant, []);

    await expect(
      caller().tcg.wants.update({ id: WANT_ID, languages: ["en"], maxPrice: 30, minCondition: "MP" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/** The caller's Want, as the ownership lookup finds it. */
const wantIs = (status: string) => mockDb.onSelect(tcgWant, [{ status }]);

describe("tcg.wants.drop / reopen", () => {
  it("drops an open Want", async () => {
    wantIs("open");
    mockDb.onUpdate(tcgWant, [{ id: WANT_ID }]);

    await caller().tcg.wants.drop({ id: WANT_ID });

    expect(mockDb.selected(tcgWant)).toEqual([[WANT_ID, USER_ID]]);
    expect(mockDb.updated(tcgWant)).toEqual([{ set: { status: "dropped" }, where: [WANT_ID, USER_ID, "open"] }]);
  });

  it("reopens a dropped Want", async () => {
    wantIs("dropped");
    mockDb.onUpdate(tcgWant, [{ id: WANT_ID }]);

    await caller().tcg.wants.reopen({ id: WANT_ID });

    expect(mockDb.updated(tcgWant)).toEqual([{ set: { status: "open" }, where: [WANT_ID, USER_ID, "dropped"] }]);
  });

  it.each([
    ["drop", "ordered"],
    ["drop", "fulfilled"],
    ["drop", "dropped"],
    ["reopen", "open"],
    ["reopen", "ordered"],
    ["reopen", "fulfilled"],
  ] as const)("rejects %s from %s", async (action, status) => {
    wantIs(status);

    await expect(caller().tcg.wants[action]({ id: WANT_ID })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockDb.updated(tcgWant)).toEqual([]);
  });

  it("rejects another user's Want with NOT_FOUND", async () => {
    mockDb.onSelect(tcgWant, []);

    await expect(caller().tcg.wants.drop({ id: WANT_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDb.selected(tcgWant)).toEqual([[WANT_ID, USER_ID]]);
    expect(mockDb.updated(tcgWant)).toEqual([]);
  });
});
