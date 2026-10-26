import { describe, expect, it } from "vitest";

import { en, fixtureDistance, ja } from "./fixtures";
import { pairEnglish } from "./pairing";

const { pairs } = pairEnglish({ ja, en, overrides: {}, distance: fixtureDistance });

/** EN list ID → paired JA variant ID (null = English-only) for one card's records. */
const pairsOf = (cardNumber: string) =>
  Object.fromEntries([...pairs].filter(([id]) => id.split("_")[0] === cardNumber));

describe("pairEnglish on the research's worked examples (KOI-354)", () => {
  it("OP05-119: English suffixes after the PRB-01 reprint pair one Japanese suffix lower", () => {
    expect(pairsOf("OP05-119")).toEqual({
      "OP05-119": "OP05-119",
      "OP05-119_p1": "OP05-119_p1",
      "OP05-119_p2": "OP05-119_p2",
      "OP05-119_p4": "OP05-119_p3",
      "OP05-119_r1": "OP05-119_r1",
      "OP05-119_r2": "OP05-119_r2",
      "OP05-119_p6": "OP05-119_p5",
      "OP05-119_p7": "OP05-119_p6",
      "OP05-119_p8": "OP05-119_p7",
    });
  });

  it("OP01-006: IDs that exist in both languages are still different art", () => {
    expect(pairsOf("OP01-006")).toEqual({
      "OP01-006": "OP01-006",
      "OP01-006_p1": "OP01-006_p4",
      "OP01-006_p3": "OP01-006_p1",
      "OP01-006_p4": "OP01-006_p2",
      "OP01-006_p5": "OP01-006_p3",
      "OP01-006_r1": "OP01-006_r1",
    });
  });

  it("OP09-014: image, not list order, pairs PRB-02 prints listed in another order", () => {
    expect(pairsOf("OP09-014")).toMatchObject({
      "OP09-014_p1": "OP09-014_p3",
      "OP09-014_p2": "OP09-014_p2",
      "OP09-014_r2": "OP09-014_r2",
    });
  });

  it("EB01-015: a starter-deck parallel pairs a Japanese reprint; different-art promos are English-only", () => {
    expect(pairsOf("EB01-015")).toEqual({
      "EB01-015": "EB01-015",
      "EB01-015_p1": "EB01-015_p1",
      "EB01-015_p2": null,
      "EB01-015_p3": "EB01-015_r1",
      "EB01-015_p4": null,
      "EB01-015_p5": "EB01-015_p2",
      "EB01-015_r1": "EB01-015_r2",
    });
  });

  it("pairs across packs when the languages file a print differently", () => {
    expect(pairs.get("OP07-091_p1")).toBe("OP07-091_p1");
  });

  it("never pairs two English prints with one Japanese variant", () => {
    const paired = [...pairs.values()].filter((ja) => ja !== null);
    expect(new Set(paired).size).toBe(paired.length);
  });
});

/** Records of one card, `id@pack`, in list order. Pack suffixes only: `105` is JA `550105`, EN `569105`. */
const records = (lang: "ja" | "en", ...ids: string[]) =>
  ids.map((s) => {
    const [id, pack] = s.split("@");
    return { id: id!, pack_id: `${lang === "ja" ? "550" : "569"}${pack}` };
  });
const table =
  (t: Record<string, number>) =>
  (en: string, ja: string): number =>
    t[`${en}|${ja}`] ?? 0.9;

describe("pairEnglish rules", () => {
  const ja = records("ja", "X@105", "X_p1@105", "X_p2@301");
  const en = records("en", "X@105", "X_p1@105", "X_p3@301");
  const distance = table({ "X|X": 0.01, "X_p1|X_p1": 0.01, "X_p3|X_p2": 0.01 });

  it("an override wins over the pack", () => {
    const { pairs, report } = pairEnglish({ ja, en, overrides: { X_p3: "english-only" }, distance });
    expect(pairs.get("X_p3")).toBeNull();
    expect(report.tiers.override).toBe(1);
  });

  it("refuses an override to a Japanese variant the card doesn't have", () => {
    expect(() => pairEnglish({ ja, en, overrides: { X_p3: "X_p9" }, distance })).toThrow(/X_p9/);
  });

  it("asks for images only of English prints the pack doesn't settle, and their free Japanese candidates", () => {
    const { needsImages, report } = pairEnglish({ ja, en, overrides: {}, distance: () => undefined });
    expect(report.tiers.pack).toBe(1);
    expect(needsImages).toEqual({ en: ["X", "X_p1"], ja: ["X", "X_p1"] });
  });

  it("reuses a stored pairing while its Japanese variant is free, so no image is needed", () => {
    const stored = { pairs: new Map([["X", "X"], ["X_p1", "X_p1"], ["X_p3", "X_p2"]]), ja: new Set(["X", "X_p1", "X_p2"]) };
    const { pairs, report, needsImages } = pairEnglish({ ja, en, overrides: {}, stored, distance: () => undefined });
    expect(Object.fromEntries(pairs)).toEqual({ X: "X", X_p1: "X_p1", X_p3: "X_p2" });
    expect(report.tiers.stored).toBe(2);
    expect(needsImages).toEqual({ en: [], ja: [] });
  });

  it("keeps a stored English-only print until a new Japanese variant appears", () => {
    const en = records("en", "Y@105", "Y_p1@901");
    const stored = { pairs: new Map([["Y", "Y"], ["Y_p1", null]]), ja: new Set(["Y"]) };
    const settled = pairEnglish({ ja: records("ja", "Y@105"), en, overrides: {}, stored, distance: () => undefined });
    expect(settled.pairs.get("Y_p1")).toBeNull();
    expect(settled.needsImages.en).toEqual([]);

    const reopened = pairEnglish({ ja: records("ja", "Y@105", "Y_p1@901"), en, overrides: {}, stored, distance: () => undefined });
    expect(reopened.needsImages).toEqual({ en: ["Y_p1"], ja: ["Y_p1"] });
  });

  it("pairs identical-art twins in a pack by list order", () => {
    const { pairs } = pairEnglish({
      ja: records("ja", "Z_p1@301", "Z_r1@301"),
      en: records("en", "Z_p2@301", "Z_r1@301"),
      overrides: {},
      distance: table({ "Z_p2|Z_p1": 0.001, "Z_p2|Z_r1": 0.001, "Z_r1|Z_p1": 0.001, "Z_r1|Z_r1": 0.001 }),
    });
    expect(Object.fromEntries(pairs)).toEqual({ Z_p2: "Z_p1", Z_r1: "Z_r1" });
  });

  it("pairs twins by list order when one language lists another print before them", () => {
    const twins = { "V_p2|V_p1": 0.001, "V_p2|V_r1": 0.001, "V_r1|V_p1": 0.001, "V_r1|V_r1": 0.001 };
    const { pairs } = pairEnglish({
      ja: records("ja", "V_p1@301", "V_r1@301"),
      en: records("en", "V_p1@301", "V_p2@301", "V_r1@301"),
      overrides: {},
      distance: table(twins),
    });
    expect(Object.fromEntries(pairs)).toEqual({ V_p1: null, V_p2: "V_p1", V_r1: "V_r1" });
  });

  it("reports a gray-zone pair as a best guess", () => {
    const { pairs, report } = pairEnglish({
      ja: records("ja", "W_p3@901"),
      en: records("en", "W_p1@901"),
      overrides: {},
      distance: table({ "W_p1|W_p3": 0.39 }),
    });
    expect(pairs.get("W_p1")).toBe("W_p3");
    expect(report.grayZone).toEqual([{ en: "W_p1", ja: "W_p3", distance: 0.39 }]);
  });

  it("reports English twins competing for one Japanese print, the first listed winning", () => {
    const { pairs, report } = pairEnglish({
      ja: records("ja", "P-078@901"),
      en: records("en", "P-078@901", "P-078_p1@901", "P-078_p2@901", "P-078_p3@901"),
      overrides: {},
      distance: table({ "P-078|P-078": 0.001, "P-078_p1|P-078": 0.001, "P-078_p2|P-078": 0.001 }),
    });
    expect(pairs.get("P-078")).toBe("P-078");
    expect(report.twinContests).toEqual([{ ja: "P-078", winner: "P-078", losers: ["P-078_p1", "P-078_p2"] }]);
    expect(report.englishOnly).toEqual(["P-078_p3"]);
  });
});
