import { describe, expect, it } from "vitest";

import { binderPockets, binderSheet } from "./tcg-binder";

/** Owned Artworks a1 … aN, in binder order. */
const owned = (n: number) => Array.from({ length: n }, (_, i) => `a${i + 1}`);

describe("binderSheet", () => {
  it("fills the last sheet's leftover pockets with empty ones", () => {
    expect(binderSheet(owned(20), 3)).toEqual({
      page: 3,
      pages: 3,
      pockets: ["a19", "a20", null, null, null, null, null, null, null],
    });
  });

  it("opens the last sheet for a page past the end, as when Copies are gone since the link was made", () => {
    expect(binderSheet(owned(10), 7)).toMatchObject({ page: 2, pages: 2 });
    expect(binderSheet(owned(10), 7).pockets[0]).toBe("a10");
  });

  it("an empty collection is one sheet of empty pockets", () => {
    expect(binderSheet([], 1)).toEqual({ page: 1, pages: 1, pockets: Array(9).fill(null) });
  });
});

/** A Copy, named by `id`; the rest defaults to an EN NM Copy of OP01-001 acquired Oct 1. */
const copy = (id: string, extra: Partial<Parameters<typeof binderPockets>[0][number]> = {}) => ({
  id,
  variantId: "OP01-001",
  language: "en" as const,
  condition: "NM" as const,
  acquiredOn: "2026-10-01",
  createdAt: "2026-10-01T12:00:00.000Z",
  ...extra,
});
const order = (copies: ReturnType<typeof copy>[]) => binderPockets(copies).map((c) => c.id);

describe("binderPockets", () => {
  it("orders Pockets by card number (variant ID) across Artworks", () => {
    expect(
      order([copy("b", { variantId: "OP01-002" }), copy("p1", { variantId: "OP01-001_p1" }), copy("a", { variantId: "OP01-001" })]),
    ).toEqual(["a", "p1", "b"]);
  });

  it("puts an Artwork's Copies in language order EN, JA, ZH, KO", () => {
    expect(
      order([copy("ko", { language: "ko" }), copy("ja", { language: "ja" }), copy("zh", { language: "zh" }), copy("en")]),
    ).toEqual(["en", "ja", "zh", "ko"]);
  });

  it("puts the best Condition first within a language", () => {
    expect(order([copy("dmg", { condition: "DMG" }), copy("lp", { condition: "LP" }), copy("nm")])).toEqual(["nm", "lp", "dmg"]);
  });

  it("breaks a tie by acquired date, oldest first, then by when the Copy was added", () => {
    expect(
      order([
        copy("late", { acquiredOn: "2026-10-09" }),
        copy("added-second", { createdAt: "2026-10-02T00:00:00.000Z" }),
        copy("added-first"),
      ]),
    ).toEqual(["added-first", "added-second", "late"]);
  });

  it("orders Copies added at the same instant by id, so the order is total", () => {
    expect(order([copy("c2"), copy("c1")])).toEqual(["c1", "c2"]);
  });

  it("keeps two Copies of one Printing as two Pockets", () => {
    expect(order([copy("one"), copy("two", { createdAt: "2026-10-02T00:00:00.000Z" })])).toEqual(["one", "two"]);
  });
});
