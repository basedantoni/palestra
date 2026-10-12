import { describe, expect, it } from "vitest";

import { limitlessPage } from "./fixtures";
import { parseLimitlessCardPage, reconcileArtists } from "./limitless";

describe("parseLimitlessCardPage", () => {
  it("reads the base Artwork's variant ID, artist, and the other prints to fetch", () => {
    expect(parseLimitlessCardPage(limitlessPage("en-OP05-069"))).toEqual({
      variantId: "OP05-069",
      artist: "Minato Sashima",
      label: null,
      versions: ["/cards/OP05-069?v=1", "/cards/OP05-069?v=2"],
    });
  });

  it("identifies a parallel by its image filename and keeps the credited artist's casing", () => {
    expect(parseLimitlessCardPage(limitlessPage("en-OP05-069-v1"))).toMatchObject({
      variantId: "OP05-069_p1",
      artist: "AKIRA EGAWA",
      label: "aa",
    });
  });

  it("leaves an uncredited Artwork's artist blank and reads its manga label", () => {
    expect(parseLimitlessCardPage(limitlessPage("en-OP05-069-v2"))).toMatchObject({
      variantId: "OP05-069_p2",
      artist: null,
      label: "manga",
    });
  });

  it("reads Japanese pages the same way", () => {
    expect(parseLimitlessCardPage(limitlessPage("jp-OP05-069"))).toEqual({
      variantId: "OP05-069",
      artist: "Minato Sashima",
      label: null,
      versions: ["/cards/jp/OP05-069?v=1", "/cards/jp/OP05-069?v=2"],
    });
    expect(parseLimitlessCardPage(limitlessPage("jp-OP05-069-v1"))).toMatchObject({
      variantId: "OP05-069_p1",
      artist: "AKIRA EGAWA",
    });
  });

  it("returns no variant for a page without a card image", () => {
    expect(parseLimitlessCardPage("<html><body>Not found</body></html>").variantId).toBeNull();
  });
});

const page = (name: string) => parseLimitlessCardPage(limitlessPage(name));
const op05069 = {
  en: [page("en-OP05-069"), page("en-OP05-069-v1"), page("en-OP05-069-v2")],
  ja: [page("jp-OP05-069"), page("jp-OP05-069-v1"), page("jp-OP05-069-v2")],
};
const uncredited = [
  { variantId: "OP05-069", artist: null },
  { variantId: "OP05-069_p1", artist: null },
  { variantId: "OP05-069_p2", artist: null },
];
const variant = (variantId: string, artist: string | null, label: string | null = null) => ({
  variantId,
  artist,
  label,
  versions: [],
});

describe("reconcileArtists", () => {
  it("credits each Artwork from Limitless, uncredited stays blank, and the manga label marks manga", () => {
    expect(reconcileArtists(uncredited, op05069)).toEqual([
      { variantId: "OP05-069", artist: "Minato Sashima", artistConflict: false, manga: false },
      { variantId: "OP05-069_p1", artist: "AKIRA EGAWA", artistConflict: false, manga: false },
      { variantId: "OP05-069_p2", artist: null, artistConflict: false, manga: true },
    ]);
  });

  it("flags an Artwork whose languages credit different artists and keeps the existing artist", () => {
    const ja = [...op05069.ja.slice(0, 2), variant("OP05-069_p2", "Tadaichi Nakama", "manga")];
    const en = [...op05069.en.slice(0, 2), variant("OP05-069_p2", "Nakamaru", "manga")];
    const existing = [...uncredited.slice(0, 2), { variantId: "OP05-069_p2", artist: "Nakamaru" }];

    expect(reconcileArtists(existing, { ja, en })[2]).toEqual({
      variantId: "OP05-069_p2",
      artist: "Nakamaru",
      artistConflict: true,
      manga: true,
    });
    expect(reconcileArtists(uncredited, { ja, en })[2]).toMatchObject({ artist: null, artistConflict: true });
  });

  it("does not flag the same artist written in a different case, or a language that credits nobody", () => {
    const [sameArtist] = reconcileArtists([{ variantId: "OP05-069_p1", artist: null }], {
      ja: [variant("OP05-069_p1", "Akira Egawa")],
      en: [variant("OP05-069_p1", "AKIRA EGAWA")],
    });
    expect(sameArtist).toMatchObject({ artist: "AKIRA EGAWA", artistConflict: false });

    const [jaOnly] = reconcileArtists([{ variantId: "OP05-069_p1", artist: null }], {
      ja: [variant("OP05-069_p1", "AKIRA EGAWA")],
      en: [variant("OP05-069_p1", null)],
    });
    expect(jaOnly).toMatchObject({ artist: "AKIRA EGAWA", artistConflict: false });
  });

  it("clears a flag once both languages agree, and skips Artworks Limitless doesn't list", () => {
    expect(
      reconcileArtists(
        [
          { variantId: "OP05-069", artist: "Old Name" },
          { variantId: "OP05-069_p9", artist: "Kept" },
        ],
        op05069,
      ),
    ).toEqual([{ variantId: "OP05-069", artist: "Minato Sashima", artistConflict: false, manga: false }]);
  });
});
