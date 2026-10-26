/**
 * Hand-reviewed English → Japanese pairings (KOI-332, ADR 0006): what the import's
 * report flags and art distance can't settle. Gray-zone pairs (a Regionals stamp
 * across the art, text-as-art events) and twin contests (several English promos
 * with the identical scan of one Japanese print). Each entry says why.
 *
 * EN list ID → JA variant ID, or "english-only". Drafted from a full local
 * `db:import:tcg --repair` against punk-records on 2026-10-26.
 */
import type { PairingOverrides } from "./pairing";

export const pairingOverrides: PairingOverrides = {
  // Gray zone (art distance 0.20–0.60): the same illustration by eye, so paired.
  "ST01-004_p1": "ST01-004_p2", // 0.39: English Participant stamp across the art
  "ST03-014_p1": "ST03-014_p1", // 0.54: English Participant stamp across the art
  "ST04-008_p1": "ST04-008_p1", // 0.57: English Participant stamp across the art
  "ST07-008_p1": "ST07-008_p1", // 0.41: English Participant stamp across the art
  "OP02-035_p1": "OP02-035_p1", // 0.23: English Participant stamp across the art
  "OP02-098_p1": "OP02-098_p1", // 0.52: English Participant stamp across the art
  "OP03-089_p1": "OP03-089_p1", // 0.42: English Regionals stamp across the art
  "OP06-110_p1": "OP06-110_p3", // 0.48: English Regionals stamp across the art
  "P-085_p1": "P-085", // 0.41: English Regionals Finalist stamp across the art
  "OP01-015_p1": "OP01-015_p1", // 0.23: English Regionals stamp across the art
  "OP02-063_p1": "OP02-063_p1", // 0.55: English Regionals stamp across the art
  "OP04-092_p3": "OP04-092_p1", // 0.22: English Championship stamp across the art
  "OP07-080_p1": "OP07-080_p1", // 0.38: English Championship stamp across the art
  "EB01-038_p1": "EB01-038_p1", // 0.50: the art is lettering, translated
  "EB01-038_r1": "EB01-038_r1", // 0.56: the art is lettering, translated
  "P-036": "P-036", // 0.43: brighter English scan, solid vs outlined SAMPLE watermark

  // Twin contests: several English prints show the identical scan (< 0.05) of one
  // Japanese print, differing only in a real-world stamp or distribution. No data
  // tells them apart: list order picks the partner; the rest are English-only.
  // Unverified: correct an entry if the physical cards say otherwise.
  "ST01-011_p2": "ST01-011_p2", // list order's pick
  "ST01-011_p5": "english-only", // same scan as JA ST01-011_p2, which pairs EN ST01-011_p2
  "ST01-012_p5": "ST01-012_p7", // list order's pick
  "ST01-012_p6": "english-only", // same scan as JA ST01-012_p7, which pairs EN ST01-012_p5
  "ST06-006_p1": "ST06-006_p1", // list order's pick
  "ST06-006_p4": "english-only", // same scan as JA ST06-006_p1, which pairs EN ST06-006_p1
  "ST06-006_p3": "english-only", // same scan as JA ST06-006_p1, which pairs EN ST06-006_p1
  "P-030": "P-030", // list order's pick
  "P-030_p3": "english-only", // same scan as JA P-030, which pairs EN P-030
  "ST17-003_p1": "ST17-003_p1", // list order's pick
  "ST17-003_p2": "english-only", // same scan as JA ST17-003_p1, which pairs EN ST17-003_p1
  "OP05-067_p2": "OP05-067_p2", // list order's pick
  "OP05-067_p5": "english-only", // same scan as JA OP05-067_p2, which pairs EN OP05-067_p2
  "OP05-067_p6": "english-only", // same scan as JA OP05-067_p2, which pairs EN OP05-067_p2
  "OP07-021_p1": "OP07-021_p2", // list order's pick
  "OP07-021_p4": "english-only", // same scan as JA OP07-021_p2, which pairs EN OP07-021_p1
  "OP07-021_p5": "english-only", // same scan as JA OP07-021_p2, which pairs EN OP07-021_p1
  "OP07-021_p6": "english-only", // same scan as JA OP07-021_p2, which pairs EN OP07-021_p1
  "OP07-021_p7": "english-only", // same scan as JA OP07-021_p2, which pairs EN OP07-021_p1
  "OP09-043_p1": "OP09-043_p1", // list order's pick
  "OP09-043_p2": "english-only", // same scan as JA OP09-043_p1, which pairs EN OP09-043_p1
  "OP09-043_p3": "english-only", // same scan as JA OP09-043_p1, which pairs EN OP09-043_p1
  "OP09-089_p1": "OP09-089_p1", // list order's pick
  "OP09-089_p2": "english-only", // same scan as JA OP09-089_p1, which pairs EN OP09-089_p1
  "OP09-089_p3": "english-only", // same scan as JA OP09-089_p1, which pairs EN OP09-089_p1
  "OP03-116_p1": "OP03-116_p1", // list order's pick
  "OP03-116_p3": "english-only", // same scan as JA OP03-116_p1, which pairs EN OP03-116_p1
  "OP06-063_p2": "OP06-063_p1", // list order's pick
  "OP06-063_p3": "english-only", // same scan as JA OP06-063_p1, which pairs EN OP06-063_p2
  "OP06-063_p4": "english-only", // same scan as JA OP06-063_p1, which pairs EN OP06-063_p2
  "OP06-101_p3": "OP06-101_p3", // list order's pick
  "OP06-101_p4": "english-only", // same scan as JA OP06-101_p3, which pairs EN OP06-101_p3
  "OP06-101_p5": "english-only", // same scan as JA OP06-101_p3, which pairs EN OP06-101_p3
  "OP07-040_p2": "OP07-040_p2", // list order's pick
  "OP07-040_p1": "english-only", // same scan as JA OP07-040_p2, which pairs EN OP07-040_p2
  "OP07-047_p2": "OP07-047_p2", // list order's pick
  "OP07-047_p3": "english-only", // same scan as JA OP07-047_p2, which pairs EN OP07-047_p2
  "OP07-047_p4": "english-only", // same scan as JA OP07-047_p2, which pairs EN OP07-047_p2
  "OP07-053_p3": "OP07-053_p3", // list order's pick
  "OP07-053_p4": "english-only", // same scan as JA OP07-053_p3, which pairs EN OP07-053_p3
  "OP07-066_p1": "OP07-066_p1", // list order's pick
  "OP07-066_p2": "english-only", // same scan as JA OP07-066_p1, which pairs EN OP07-066_p1
  "OP07-109_p3": "OP07-109_p3", // list order's pick
  "OP07-109_p4": "english-only", // same scan as JA OP07-109_p3, which pairs EN OP07-109_p3
  "OP09-027_p2": "OP09-027_p1", // list order's pick
  "OP09-027_p3": "english-only", // same scan as JA OP09-027_p1, which pairs EN OP09-027_p2
  "OP09-106_p1": "OP09-106_p1", // list order's pick
  "OP09-106_p3": "english-only", // same scan as JA OP09-106_p1, which pairs EN OP09-106_p1
  "OP09-106_p4": "english-only", // same scan as JA OP09-106_p1, which pairs EN OP09-106_p1
  "OP09-106_p5": "english-only", // same scan as JA OP09-106_p1, which pairs EN OP09-106_p1
  "OP09-106_p6": "english-only", // same scan as JA OP09-106_p1, which pairs EN OP09-106_p1
  "OP10-107_p1": "OP10-107_p1", // list order's pick
  "OP10-107_p2": "english-only", // same scan as JA OP10-107_p1, which pairs EN OP10-107_p1
  "OP10-107_p3": "english-only", // same scan as JA OP10-107_p1, which pairs EN OP10-107_p1
  "OP12-015_p1": "OP12-015_p1", // list order's pick
  "OP12-015_p2": "english-only", // same scan as JA OP12-015_p1, which pairs EN OP12-015_p1
  "EB01-003_p2": "EB01-003_p2", // list order's pick
  "EB01-003_p3": "english-only", // same scan as JA EB01-003_p2, which pairs EN EB01-003_p2
  "EB01-003_p4": "english-only", // same scan as JA EB01-003_p2, which pairs EN EB01-003_p2
  "EB01-043_p1": "EB01-043_p1", // list order's pick
  "EB01-043_p2": "english-only", // same scan as JA EB01-043_p1, which pairs EN EB01-043_p1
  "EB01-043_p3": "english-only", // same scan as JA EB01-043_p1, which pairs EN EB01-043_p1
  "EB01-043_p4": "english-only", // same scan as JA EB01-043_p1, which pairs EN EB01-043_p1
  "EB01-043_p5": "english-only", // same scan as JA EB01-043_p1, which pairs EN EB01-043_p1
  "EB01-043_p6": "english-only", // same scan as JA EB01-043_p1, which pairs EN EB01-043_p1
  "P-069_p3": "P-069_r1", // list order's pick
  "P-069_p1": "english-only", // same scan as JA P-069_r1, which pairs EN P-069_p3
  "P-069_r1": "P-069_p2", // list order's pick
  "P-069_p2": "english-only", // same scan as JA P-069_p2, which pairs EN P-069_r1
  "P-069_p4": "P-069_p1", // list order's pick
  "P-069_p5": "english-only", // same scan as JA P-069_p1, which pairs EN P-069_p4
  "P-069_p6": "english-only", // same scan as JA P-069_p1, which pairs EN P-069_p4
  "P-070_p3": "P-070_p1", // list order's pick
  "P-070_p1": "english-only", // same scan as JA P-070_p1, which pairs EN P-070_p3
  "P-070_p2": "english-only", // same scan as JA P-070_p1, which pairs EN P-070_p3
  "P-078": "P-078", // list order's pick
  "P-078_p1": "english-only", // same scan as JA P-078, which pairs EN P-078
  "P-078_p2": "english-only", // same scan as JA P-078, which pairs EN P-078
  "P-078_p3": "english-only", // same scan as JA P-078, which pairs EN P-078
  "P-078_p4": "english-only", // same scan as JA P-078, which pairs EN P-078
  "P-078_p5": "english-only", // same scan as JA P-078, which pairs EN P-078
  "P-079": "P-079", // list order's pick
  "P-079_p1": "english-only", // same scan as JA P-079, which pairs EN P-079
  "P-079_p2": "english-only", // same scan as JA P-079, which pairs EN P-079
  "P-082_p2": "P-082_p2", // list order's pick
  "P-082_p1": "english-only", // same scan as JA P-082_p2, which pairs EN P-082_p2
  "P-083_p3": "P-083_r1", // list order's pick
  "P-083_p1": "english-only", // same scan as JA P-083_r1, which pairs EN P-083_p3
  "P-083_p2": "english-only", // same scan as JA P-083_r1, which pairs EN P-083_p3
  "P-045": "P-045", // list order's pick
  "P-045_p1": "english-only", // same scan as JA P-045, which pairs EN P-045
  "P-065": "P-065", // list order's pick
  "P-065_p1": "english-only", // same scan as JA P-065, which pairs EN P-065
  "P-065_p2": "english-only", // same scan as JA P-065, which pairs EN P-065
  "P-077": "P-077", // list order's pick
  "P-077_p1": "english-only", // same scan as JA P-077, which pairs EN P-077
  "P-077_p2": "english-only", // same scan as JA P-077, which pairs EN P-077
  "P-089": "P-089", // list order's pick
  "P-089_p1": "english-only", // same scan as JA P-089, which pairs EN P-089
  "P-089_p2": "english-only", // same scan as JA P-089, which pairs EN P-089
  "P-096": "P-096", // list order's pick
  "P-096_p1": "english-only", // same scan as JA P-096, which pairs EN P-096
  "P-110": "P-110", // list order's pick
  "P-110_p1": "english-only", // same scan as JA P-110, which pairs EN P-110
  "P-111": "P-111", // list order's pick
  "P-111_p1": "english-only", // same scan as JA P-111, which pairs EN P-111
  "P-113": "P-113", // list order's pick
  "P-113_p1": "english-only", // same scan as JA P-113, which pairs EN P-113
  "P-115": "P-115", // list order's pick
  "P-115_p1": "english-only", // same scan as JA P-115, which pairs EN P-115
};
