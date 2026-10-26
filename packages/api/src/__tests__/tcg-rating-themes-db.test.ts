/**
 * Art Rating and Themes against a real Postgres (PGlite, KOI-307): browse
 * filters and sort run as SQL; Theme names are unique per user; deleting a
 * Theme removes its tags.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import { tcgArtRating, tcgArtworkTheme, user } from "@life-tracker/db/schema/index";

import { upsertCatalog } from "../lib/tcg/catalog-db";
import { catalog } from "../lib/tcg/fixtures";
import { appRouter } from "../routers/index";
import { truncateAll } from "./helpers/pglite";

const as = (id: string) => appRouter.createCaller({ session: { user: { id } } } as any);
const me = as("user-me");
const other = as("user-other");

const ids = (rows: Array<{ variantId: string }>) => rows.map((r) => r.variantId);

beforeEach(async () => {
  await truncateAll(db);
  await upsertCatalog(catalog);
  await db.insert(user).values(
    ["user-me", "user-other"].map((id) => ({ id, name: id, email: `${id}@test.local`, emailVerified: true })),
  );
});

describe("Art Rating", () => {
  it("changes and clears a rating, keeping one row per Artwork", async () => {
    await me.tcg.setRating({ variantId: "OP05-119_p1", rating: 2 });
    await me.tcg.setRating({ variantId: "OP05-119_p1", rating: 5 });
    expect(await db.select({ rating: tcgArtRating.rating }).from(tcgArtRating)).toEqual([{ rating: 5 }]);

    await me.tcg.setRating({ variantId: "OP05-119_p1", rating: null });
    expect(await db.select().from(tcgArtRating)).toEqual([]);
  });

  it("rejects an Artwork not in the catalog", async () => {
    await expect(me.tcg.setRating({ variantId: "NOPE-000", rating: 3 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("browse shows the caller's rating only", async () => {
    await me.tcg.setRating({ variantId: "OP05-119_p1", rating: 4 });
    await other.tcg.setRating({ variantId: "OP05-119_p2", rating: 5 });

    const rows = await me.tcg.artworks({});
    expect(rows.find((r) => r.variantId === "OP05-119_p1")?.rating).toBe(4);
    expect(rows.find((r) => r.variantId === "OP05-119_p2")?.rating).toBeNull();
  });

  it("browse filters by minimum rating", async () => {
    await me.tcg.setRating({ variantId: "OP05-119_p1", rating: 4 });
    await me.tcg.setRating({ variantId: "OP05-119_p2", rating: 2 });
    await me.tcg.setRating({ variantId: "OP08-119", rating: 0 });
    await other.tcg.setRating({ variantId: "OP05-119_p3", rating: 5 });

    expect(ids(await me.tcg.artworks({ minRating: 2 }))).toEqual(["OP05-119_p1", "OP05-119_p2"]);
    expect(ids(await me.tcg.artworks({ minRating: 0 }))).toEqual(["OP05-119_p1", "OP05-119_p2", "OP08-119"]);
  });

  it("browse sorts by rating, highest first, unrated last", async () => {
    await me.tcg.setRating({ variantId: "OP05-119_p2", rating: 5 });
    await me.tcg.setRating({ variantId: "OP08-119", rating: 3 });
    const rows = ids(await me.tcg.artworks({ sort: "rating" }));
    expect(rows.slice(0, 2)).toEqual(["OP05-119_p2", "OP08-119"]);
    expect(rows.length).toBeGreaterThan(2);
  });
});

describe("Themes", () => {
  it("names are unique per user, ignoring case", async () => {
    await me.tcg.createTheme({ name: "D Clan" });
    await expect(me.tcg.createTheme({ name: "d clan" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(other.tcg.createTheme({ name: "D Clan" })).resolves.toMatchObject({ name: "D Clan" });

    const kids = await me.tcg.createTheme({ name: "Kids" });
    await expect(me.tcg.renameTheme({ id: kids.id, name: "D CLAN" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("browse filters by Theme and shows each Artwork's Themes", async () => {
    const dClan = await me.tcg.createTheme({ name: "D Clan" });
    const kids = await me.tcg.createTheme({ name: "Kids" });
    await me.tcg.tagArtwork({ themeId: dClan.id, variantId: "OP05-119_p1" });
    await me.tcg.tagArtwork({ themeId: dClan.id, variantId: "OP05-119_p2" });
    await me.tcg.tagArtwork({ themeId: kids.id, variantId: "OP05-119_p1" });
    await me.tcg.tagArtwork({ themeId: kids.id, variantId: "OP05-119_p1" }); // re-tag is a no-op

    expect(ids(await me.tcg.artworks({ themeId: dClan.id }))).toEqual(["OP05-119_p1", "OP05-119_p2"]);
    const [p1] = await me.tcg.artworks({ themeId: kids.id });
    expect(p1).toMatchObject({
      variantId: "OP05-119_p1",
      themes: [
        { id: dClan.id, name: "D Clan" },
        { id: kids.id, name: "Kids" },
      ],
    });

    await me.tcg.untagArtwork({ themeId: dClan.id, variantId: "OP05-119_p2" });
    expect(ids(await me.tcg.artworks({ themeId: dClan.id }))).toEqual(["OP05-119_p1"]);
  });

  it("another user's Theme filters to nothing and its tags stay hidden", async () => {
    const theirs = await other.tcg.createTheme({ name: "Pandaman" });
    await other.tcg.tagArtwork({ themeId: theirs.id, variantId: "OP08-119" });

    expect(await me.tcg.artworks({ themeId: theirs.id })).toEqual([]);
    expect((await me.tcg.artworks({})).find((r) => r.variantId === "OP08-119")?.themes).toEqual([]);
    await expect(me.tcg.tagArtwork({ themeId: theirs.id, variantId: "OP05-119_p1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deleting a Theme removes its tags", async () => {
    const dClan = await me.tcg.createTheme({ name: "D Clan" });
    await me.tcg.tagArtwork({ themeId: dClan.id, variantId: "OP05-119_p1" });
    await me.tcg.deleteTheme({ id: dClan.id });

    expect(await db.select().from(tcgArtworkTheme)).toEqual([]);
    expect(await me.tcg.themes()).toEqual([]);
  });
});
