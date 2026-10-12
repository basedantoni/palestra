/**
 * Browse marks and filters Artworks the caller owns a Copy of (KOI-309).
 * Real SQL (PGlite): the owned check is a subquery the mock-db can't evaluate.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import { tcgCopy, tcgPrinting, user } from "@life-tracker/db/schema/index";

import { upsertCatalog } from "../lib/tcg/catalog-db";
import { transformCatalog } from "../lib/tcg/catalog-transform";
import { en, ja, packs } from "../lib/tcg/fixtures";
import { appRouter } from "../routers/index";
import { truncateAll } from "./helpers/pglite";

const ME = "user-tcg";
const OTHER = "user-other";
const caller = appRouter.createCaller({ session: { user: { id: ME } } } as any);

async function addCopy(userId: string, variantId: string, language: "ja" | "en") {
  const [printing] = await db
    .select({ id: tcgPrinting.id })
    .from(tcgPrinting)
    .where(and(eq(tcgPrinting.variantId, variantId), eq(tcgPrinting.language, language)));
  await db.insert(tcgCopy).values({ userId, printingId: printing!.id, condition: "NM", acquiredOn: "2026-10-01" });
}

beforeEach(async () => {
  await truncateAll(db);
  await upsertCatalog(transformCatalog({ ja, en, packs }));
  await db.insert(user).values([
    { id: ME, name: "Me", email: "me@example.test" },
    { id: OTHER, name: "Other", email: "other@example.test" },
  ]);
  await addCopy(ME, "OP05-119_p1", "en");
  await addCopy(OTHER, "OP08-119", "ja");
});

describe("tcg.artworks owned", () => {
  it("marks Artworks the caller owns a Copy of, in any language", async () => {
    const rows = await caller.tcg.artworks({});
    expect(rows.filter((r) => r.owned).map((r) => r.variantId)).toEqual(["OP05-119_p1"]);
  });

  it("filters to the caller's collection, ignoring other users' Copies", async () => {
    const rows = await caller.tcg.artworks({ owned: true });
    expect(rows.map((r) => r.variantId)).toEqual(["OP05-119_p1"]);
  });

  it("combines with other browse filters", async () => {
    expect(await caller.tcg.artworks({ owned: true, character: "kaido" })).toEqual([]);
  });
});

describe("tcg.artworks language", () => {
  it.each(["ja", "en"] as const)("keeps only Artworks with a %s Printing", async (language) => {
    const all = await caller.tcg.artworks({});
    const inLanguage = all.filter((a) => a.printings.some((p) => p.language === language)).map((a) => a.variantId);
    // The fixtures include a Japanese-only and an English-only parallel.
    expect(inLanguage.length).toBeLessThan(all.length);

    const rows = await caller.tcg.artworks({ language });
    expect(rows.map((r) => r.variantId)).toEqual(inLanguage);
  });

  it("with owned, keeps Artworks the caller owns a Copy of in that language", async () => {
    // The caller's only Copy is OP05-119_p1 in English, though it is printed in Japanese too.
    expect((await caller.tcg.artworks({ owned: true, language: "en" })).map((r) => r.variantId)).toEqual([
      "OP05-119_p1",
    ]);
    expect(await caller.tcg.artworks({ owned: true, language: "ja" })).toEqual([]);
  });
});
