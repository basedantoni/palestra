/**
 * TCG Art Rating and Themes through the `tcg` router (KOI-307), on the shared
 * mock-db. Every write is scoped to the caller; another user's Theme is NOT_FOUND.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));

import { tcgArtRating, tcgArtworkTheme, tcgTheme } from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { mockDb, rejectWith } from "./helpers/mock-db";

const USER_ID = "user-tcg";
const caller = appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);

describe("tcg.setRating", () => {
  it("rates an Artwork for the caller", async () => {
    await caller.tcg.setRating({ variantId: "OP05-069_p1", rating: 4 });
    expect(mockDb.inserted(tcgArtRating)).toEqual([{ userId: USER_ID, variantId: "OP05-069_p1", rating: 4 }]);
  });

  it("clears only the caller's rating", async () => {
    await caller.tcg.setRating({ variantId: "OP05-069_p1", rating: null });
    expect(mockDb.inserted(tcgArtRating)).toEqual([]);
    expect(mockDb.deleted(tcgArtRating)).toEqual([[USER_ID, "OP05-069_p1"]]);
  });

  it("rejects a rating outside 0–5", async () => {
    await expect(caller.tcg.setRating({ variantId: "OP05-069", rating: 6 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller.tcg.setRating({ variantId: "OP05-069", rating: 2.5 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mockDb.inserted(tcgArtRating)).toEqual([]);
  });

  it("rejects an unknown Artwork with NOT_FOUND", async () => {
    mockDb.onInsert(tcgArtRating, rejectWith(Object.assign(new Error("fk"), { code: "23503" })));
    await expect(caller.tcg.setRating({ variantId: "NOPE-000", rating: 3 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

const THEME_ID = "11111111-1111-4111-8111-111111111111";
const duplicate = () => rejectWith(Object.assign(new Error("dup"), { cause: { code: "23505" } }));

describe("tcg themes", () => {
  it("creates a Theme owned by the caller, name trimmed", async () => {
    mockDb.onInsert(tcgTheme, (op: any) => [op.arg("values")]);
    const theme = await caller.tcg.createTheme({ name: "  D Clan " });
    expect(mockDb.inserted(tcgTheme)).toEqual([{ id: expect.any(String), userId: USER_ID, name: "D Clan" }]);
    expect(theme).toMatchObject({ id: expect.any(String), name: "D Clan" });
  });

  it("rejects a Theme name the caller already uses", async () => {
    mockDb.onInsert(tcgTheme, duplicate());
    await expect(caller.tcg.createTheme({ name: "d clan" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "You already have a Theme with that name",
    });
  });

  it("rejects a blank Theme name", async () => {
    await expect(caller.tcg.createTheme({ name: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lists only the caller's Themes", async () => {
    mockDb.onSelect(tcgTheme, [{ id: THEME_ID, name: "D Clan" }]);
    expect(await caller.tcg.themes()).toEqual([{ id: THEME_ID, name: "D Clan" }]);
    expect(mockDb.selected(tcgTheme)).toEqual([[USER_ID]]);
  });

  it("renames the caller's Theme", async () => {
    mockDb.onUpdate(tcgTheme, [{ id: THEME_ID }]);
    await caller.tcg.renameTheme({ id: THEME_ID, name: " Kids " });
    expect(mockDb.updated(tcgTheme)).toEqual([{ set: { name: "Kids" }, where: [THEME_ID, USER_ID] }]);
  });

  it("rejects renaming another user's Theme with NOT_FOUND", async () => {
    mockDb.onUpdate(tcgTheme, []);
    await expect(caller.tcg.renameTheme({ id: THEME_ID, name: "Kids" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects renaming to a name the caller already uses", async () => {
    mockDb.onUpdate(tcgTheme, duplicate());
    await expect(caller.tcg.renameTheme({ id: THEME_ID, name: "Kids" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("deletes the caller's Theme", async () => {
    mockDb.onDelete(tcgTheme, [{ id: THEME_ID }]);
    await caller.tcg.deleteTheme({ id: THEME_ID });
    expect(mockDb.deleted(tcgTheme)).toEqual([[THEME_ID, USER_ID]]);
  });

  it("rejects deleting another user's Theme with NOT_FOUND", async () => {
    mockDb.onDelete(tcgTheme, []);
    await expect(caller.tcg.deleteTheme({ id: THEME_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("tcg tagging", () => {
  const ownsTheme = () => mockDb.onSelect(tcgTheme, [{ id: THEME_ID }]);
  const tag = { themeId: THEME_ID, variantId: "OP05-069_p1" };

  it("tags an Artwork with the caller's Theme", async () => {
    ownsTheme();
    await caller.tcg.tagArtwork(tag);
    expect(mockDb.selected(tcgTheme)).toEqual([[THEME_ID, USER_ID]]);
    expect(mockDb.inserted(tcgArtworkTheme)).toEqual([tag]);
  });

  it("rejects tagging with another user's Theme", async () => {
    mockDb.onSelect(tcgTheme, []);
    await expect(caller.tcg.tagArtwork(tag)).rejects.toMatchObject({ code: "NOT_FOUND", message: "Theme not found" });
    expect(mockDb.inserted(tcgArtworkTheme)).toEqual([]);
  });

  it("rejects tagging an unknown Artwork", async () => {
    ownsTheme();
    mockDb.onInsert(tcgArtworkTheme, rejectWith(Object.assign(new Error("fk"), { code: "23503" })));
    await expect(caller.tcg.tagArtwork(tag)).rejects.toMatchObject({ code: "NOT_FOUND", message: "Artwork not found" });
  });

  it("untags an Artwork", async () => {
    ownsTheme();
    await caller.tcg.untagArtwork(tag);
    expect(mockDb.deleted(tcgArtworkTheme)).toEqual([[THEME_ID, "OP05-069_p1"]]);
  });

  it("rejects untagging with another user's Theme", async () => {
    mockDb.onSelect(tcgTheme, []);
    await expect(caller.tcg.untagArtwork(tag)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDb.deleted(tcgArtworkTheme)).toEqual([]);
  });
});
