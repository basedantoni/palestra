import { describe, expect, it } from "vitest";

import { limitlessPage } from "./fixtures";
import { parseLimitlessCardPage, reconcileArtists } from "./limitless";

describe("parseLimitlessCardPage", () => {
  it("reads the base print's Limitless ID, image, artist, and the other prints to fetch", () => {
    expect(parseLimitlessCardPage(limitlessPage("en-OP05-069"))).toEqual({
      limitlessId: "OP05-069",
      imageUrl: "https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/one-piece/OP05/OP05-069_EN.webp",
      artist: "Minato Sashima",
      label: null,
      versions: ["/cards/OP05-069?v=1", "/cards/OP05-069?v=2"],
    });
  });

  it("identifies a parallel by its image filename and keeps the credited artist's casing", () => {
    expect(parseLimitlessCardPage(limitlessPage("en-OP05-069-v1"))).toMatchObject({
      limitlessId: "OP05-069_p1",
      imageUrl: "https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/one-piece/OP05/OP05-069_p1_EN.webp",
      artist: "AKIRA EGAWA",
      label: "aa",
    });
  });

  it("leaves an uncredited Artwork's artist blank and reads its manga label", () => {
    expect(parseLimitlessCardPage(limitlessPage("en-OP05-069-v2"))).toMatchObject({
      limitlessId: "OP05-069_p2",
      artist: null,
      label: "manga",
    });
  });

  it("reads Japanese pages the same way", () => {
    expect(parseLimitlessCardPage(limitlessPage("jp-OP05-069"))).toEqual({
      limitlessId: "OP05-069",
      imageUrl: "https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/one-piece/OP05/OP05-069_JP.webp",
      artist: "Minato Sashima",
      label: null,
      versions: ["/cards/jp/OP05-069?v=1", "/cards/jp/OP05-069?v=2"],
    });
    expect(parseLimitlessCardPage(limitlessPage("jp-OP05-069-v1"))).toMatchObject({
      limitlessId: "OP05-069_p1",
      artist: "AKIRA EGAWA",
    });
  });

  it("returns no variant for a page without a card image", () => {
    expect(parseLimitlessCardPage("<html><body>Not found</body></html>")).toMatchObject({ limitlessId: null, imageUrl: null });
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
const variant = (limitlessId: string, artist: string | null, label: string | null = null) => ({
  limitlessId,
  imageUrl: null,
  artist,
  label,
  versions: [],
});
/** OP05-069 has no reprint, so Limitless's numbering matches Bandai's. */
const sameId = (variantId: string, limitlessId: string) => variantId === limitlessId;

describe("reconcileArtists", () => {
  it("credits each Artwork from Limitless, uncredited stays blank, and the manga label marks manga", () => {
    expect(reconcileArtists(uncredited, op05069, sameId)).toEqual([
      { variantId: "OP05-069", artist: "Minato Sashima", artistConflict: false, manga: false },
      { variantId: "OP05-069_p1", artist: "AKIRA EGAWA", artistConflict: false, manga: false },
      { variantId: "OP05-069_p2", artist: null, artistConflict: false, manga: true },
    ]);
  });

  it("flags an Artwork whose languages credit different artists and keeps the existing artist", () => {
    const ja = [...op05069.ja.slice(0, 2), variant("OP05-069_p2", "Tadaichi Nakama", "manga")];
    const en = [...op05069.en.slice(0, 2), variant("OP05-069_p2", "Nakamaru", "manga")];
    const existing = [...uncredited.slice(0, 2), { variantId: "OP05-069_p2", artist: "Nakamaru" }];

    expect(reconcileArtists(existing, { ja, en }, sameId)[2]).toEqual({
      variantId: "OP05-069_p2",
      artist: "Nakamaru",
      artistConflict: true,
      manga: true,
    });
    expect(reconcileArtists(uncredited, { ja, en }, sameId)[2]).toMatchObject({ artist: null, artistConflict: true });
  });

  it("does not flag the same artist written in a different case, or a language that credits nobody", () => {
    const [sameArtist] = reconcileArtists([{ variantId: "OP05-069_p1", artist: null }], {
      ja: [variant("OP05-069_p1", "Akira Egawa")],
      en: [variant("OP05-069_p1", "AKIRA EGAWA")],
    }, sameId);
    expect(sameArtist).toMatchObject({ artist: "AKIRA EGAWA", artistConflict: false });

    const [jaOnly] = reconcileArtists([{ variantId: "OP05-069_p1", artist: null }], {
      ja: [variant("OP05-069_p1", "AKIRA EGAWA")],
      en: [variant("OP05-069_p1", null)],
    }, sameId);
    expect(jaOnly).toMatchObject({ artist: "AKIRA EGAWA", artistConflict: false });
  });

  it("clears a flag once both languages agree, and skips Artworks no Limitless print matches", () => {
    expect(
      reconcileArtists(
        [
          { variantId: "OP05-069", artist: "Old Name" },
          { variantId: "OP05-069_p9", artist: "Kept" },
        ],
        op05069,
        sameId,
      ),
    ).toEqual([{ variantId: "OP05-069", artist: "Minato Sashima", artistConflict: false, manga: false }]);
  });

  it("credits the Artwork with the same art, not the same variant ID, after a reprint shifts the numbering", () => {
    // Limitless OP05-119 _p3 is the OP-09 wanted poster, Bandai Japanese _p5; Limitless _p4 is
    // the PRB-01 print, Bandai Japanese _p3 (KOI-354).
    const art: Record<string, string> = { "OP05-119_p3": "OP05-119_p4", "OP05-119_p5": "OP05-119_p3" };
    const pages = {
      ja: [variant("OP05-119_p3", "Wanted Artist"), variant("OP05-119_p4", "Reprint Artist")],
      en: [variant("OP05-119_p3", "Wanted Artist"), variant("OP05-119_p4", "Reprint Artist")],
    };
    const artworks = [
      { variantId: "OP05-119_p3", artist: null },
      { variantId: "OP05-119_p5", artist: null },
    ];

    expect(reconcileArtists(artworks, pages, (variantId, limitlessId) => art[variantId] === limitlessId)).toEqual([
      { variantId: "OP05-119_p3", artist: "Reprint Artist", artistConflict: false, manga: false },
      { variantId: "OP05-119_p5", artist: "Wanted Artist", artistConflict: false, manga: false },
    ]);
  });

  it("credits every Artwork sharing the art and flags one whose matching prints disagree", () => {
    // A reprint (_r1) shares the base scan; two identical-image promos credit different artists.
    const art: Record<string, string[]> = { "P-001": ["P-001"], "P-001_r1": ["P-001"], "P-001_p1": ["P-001_p1", "P-001_p2"] };
    const pages = {
      ja: [variant("P-001", "Base Artist"), variant("P-001_p1", "Promo Artist"), variant("P-001_p2", "Other Artist")],
      en: [],
    };
    const artworks = [
      { variantId: "P-001", artist: null },
      { variantId: "P-001_r1", artist: null },
      { variantId: "P-001_p1", artist: "Promo Artist" },
    ];

    expect(reconcileArtists(artworks, pages, (variantId, limitlessId) => art[variantId]!.includes(limitlessId))).toEqual([
      { variantId: "P-001", artist: "Base Artist", artistConflict: false, manga: false },
      { variantId: "P-001_r1", artist: "Base Artist", artistConflict: false, manga: false },
      { variantId: "P-001_p1", artist: "Promo Artist", artistConflict: true, manga: false },
    ]);
  });
});
