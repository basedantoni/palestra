/**
 * Small saved samples of real punk-records data (KOI-305, KOI-332), in list
 * order: every OP05-119 print in both languages (its manga, its PRB-01 and
 * later prints whose English suffixes drift), OP01-006, OP09-014 and EB01-015
 * (the KOI-354 research's pairing examples), OP08-119 (an `&amp;` name),
 * OP07-091_p1 (listed in two English packs), and OP13-118_p3 (a secret-rare
 * non-manga parallel). The KOI-332 records are from punk-records `a936558`.
 */
import { readFileSync } from "node:fs";

import { type PunkPacks, type PunkRecord, transformCatalog } from "../catalog-transform";
import { pairEnglish } from "../pairing";

const load = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));

export const ja: PunkRecord[] = load("./punk-records-ja.json");
export const en: PunkRecord[] = load("./punk-records-en.json");
export const packs: PunkPacks = load("./punk-records-en-packs.json");

/**
 * Art distance between the fixtures' English and Japanese Bandai scans, keyed
 * `EN list ID|JA variant ID`, from the KOI-354 research's worked examples (no
 * images are committed, ADR 0006). OP09-014's PRB-02 values are illustrative:
 * the research gives only the pairing. A pair not listed is different art.
 * OP08-119 shares its pack 1:1 and needs no image.
 */
export const artDistances: Record<string, number> = {
  "OP05-119|OP05-119": 0.002,
  "OP05-119_p1|OP05-119_p1": 0.004,
  "OP05-119_p2|OP05-119_p2": 0.003,
  "OP05-119_p4|OP05-119_p3": 0,
  "OP05-119_r1|OP05-119_r1": 0.001,
  "OP05-119_r2|OP05-119_r2": 0.001,
  "OP05-119_p6|OP05-119_p5": 0.007,
  "OP05-119_p7|OP05-119_p6": 0.054,
  "OP05-119_p8|OP05-119_p7": 0.09,
  "OP01-006|OP01-006": 0.001,
  "OP01-006_p1|OP01-006_p4": 0.025,
  "OP01-006_p3|OP01-006_p1": 0.002,
  "OP01-006_p4|OP01-006_p2": 0.002,
  "OP01-006_p5|OP01-006_p3": 0.003,
  "OP01-006_r1|OP01-006_r1": 0.001,
  // The PRB-01 reprint is the OP-01 scan: only the pack tells them apart.
  "OP01-006|OP01-006_r1": 0.001,
  "OP01-006_r1|OP01-006": 0.001,
  "OP09-014|OP09-014": 0.002,
  "OP09-014_r1|OP09-014_r1": 0.002,
  "OP09-014_p1|OP09-014_p3": 0.004,
  "OP09-014_p2|OP09-014_p2": 0.003,
  "OP09-014_r2|OP09-014_r2": 0.001,
  "EB01-015|EB01-015": 0.002,
  "EB01-015_p1|EB01-015_p1": 0.011,
  "EB01-015_p3|EB01-015_r1": 0.002,
  "EB01-015_p5|EB01-015_p2": 0.003,
  "EB01-015_r1|EB01-015_r2": 0.002,
  // Illustrative too. OP07-091_p1 is Other Product in English and a promo in Japanese.
  "OP13-118|OP13-118": 0.002,
  "OP13-118_p3|OP13-118_p3": 0.003,
  "OP07-091_p1|OP07-091_p1": 0.004,
};

export const fixtureDistance = (enListId: string, jaVariantId: string) =>
  artDistances[`${enListId}|${jaVariantId}`] ?? 0.9;

/** The fixtures' catalog as the import builds it: English paired by pack and image. */
export const catalog = transformCatalog({
  ja,
  en,
  packs,
  pairs: pairEnglish({ ja, en, overrides: {}, distance: fixtureDistance }).pairs,
});

/**
 * Saved Limitless One Piece card pages (KOI-306), fetched 2026-10-11: OP05-069
 * base (credited), `?v=1` (`_p1`, credited) and `?v=2` (`_p2` manga,
 * uncredited), English (`en-`) and Japanese (`jp-`).
 */
export const limitlessPage = (name: string): string =>
  readFileSync(new URL(`./limitless/${name}.html`, import.meta.url), "utf8");
