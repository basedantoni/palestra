import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { artDistance, artSignature, SAME_ART } from "./art-distance";

// Synthetic card scans (ADR 0006: real card images are never copied into the repo):
// seeded random blobs, upscaled to Bandai's 600×838 so the art has structure a codec keeps.
function art(seed: number): Buffer {
  let s = seed;
  const random = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 255;
  return Buffer.from(Array.from({ length: 24 * 32 * 3 }, random));
}
const card = (seed: number) => sharp(art(seed), { raw: { width: 24, height: 32, channels: 3 } }).resize(600, 838);
const png = (seed: number) => card(seed).png().toBuffer();
const webp = (seed: number) => card(seed).webp().toBuffer();

describe("artDistance", () => {
  it("finds the same art across a Bandai PNG and a Limitless WebP", async () => {
    const d = artDistance(await artSignature(await png(1)), await artSignature(await webp(1)));
    expect(d).toBeLessThan(0.05);
  });

  it("ignores the name and effect text, which differ by language", async () => {
    const text = await sharp(art(3), { raw: { width: 24, height: 16, channels: 3 } }).resize(600, 419).png().toBuffer();
    const translated = await card(1).composite([{ input: text, top: 419, left: 0 }]).png().toBuffer();
    expect(artDistance(await artSignature(await png(1)), await artSignature(translated))).toBeLessThan(0.05);
  });

  it("matches the same art under an event stamp", async () => {
    const stamp = { create: { width: 120, height: 60, channels: 3 as const, background: "#000" } };
    const stamped = await card(1).composite([{ input: stamp, top: 60, left: 40 }]).png().toBuffer();
    expect(artDistance(await artSignature(await png(1)), await artSignature(stamped))).toBeLessThan(SAME_ART);
  });

  it("tells different art apart", async () => {
    const d = artDistance(await artSignature(await png(1)), await artSignature(await png(2)));
    expect(d).toBeGreaterThan(0.6);
  });
});
