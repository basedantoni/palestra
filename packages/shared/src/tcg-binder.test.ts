import { describe, expect, it } from "vitest";

import { binderSheet } from "./tcg-binder";

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
