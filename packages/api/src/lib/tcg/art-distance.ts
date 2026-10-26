/**
 * Art distance between two card scans (ADR 0006, October 2026 amendment; KOI-354
 * research): do they show the same illustration? Compares the illustration band
 * only (rows 6–40%, inset 4% each side), above the SAMPLE watermark and the name
 * and effect text, so a Japanese and an English scan of one Artwork match.
 * Images are decoded transiently and never kept.
 */
import sharp from "sharp";

/** Below this two scans show the same art. True pairs land at 0.00–0.15, different art at 0.6–1.3. */
export const SAME_ART = 0.2;
/** Up to here it may still be the same art with a stamp or lettering difference (the gray zone); above, different art. */
export const GRAY_ART = 0.6;
/** Below this two scans are identical: twins (a reprint, a foil) that only list order tells apart. */
export const TWIN = 0.05;

const SIZE = 64;
const BLOCK = 16;

/** The illustration band in 64×64 grayscale, as 16 z-normalised 16×16 blocks. */
export type ArtSignature = Float64Array[];

/** Signature of a card image (PNG, WebP, anything sharp decodes). */
export async function artSignature(image: Uint8Array): Promise<ArtSignature> {
  const img = sharp(image);
  const { width = 0, height = 0 } = await img.metadata();
  const left = Math.floor(width * 0.04);
  const top = Math.floor(height * 0.06);
  const band = await img
    .extract({ left, top, width: Math.floor(width * 0.96) - left, height: Math.floor(height * 0.4) - top })
    .flatten()
    .grayscale()
    .resize(SIZE, SIZE, { fit: "fill" })
    .raw()
    .toBuffer();
  const n = SIZE / BLOCK;
  return [...Array(n * n).keys()].map((b) => {
    const x0 = (b % n) * BLOCK;
    const y0 = Math.floor(b / n) * BLOCK;
    const block = Float64Array.from({ length: BLOCK * BLOCK }, (_, i) => band[(y0 + Math.floor(i / BLOCK)) * SIZE + x0 + (i % BLOCK)]!);
    const mean = block.reduce((a, v) => a + v, 0) / block.length;
    const sd = Math.sqrt(block.reduce((a, v) => a + (v - mean) ** 2, 0) / block.length);
    // A flat block correlates with nothing.
    return block.map((v) => (sd ? (v - mean) / sd : 0));
  });
}

/**
 * 1 − the median per-block Pearson r: 0 for the same art, about 1 for unrelated
 * art. The median shrugs off what differs locally: translated lettering inside
 * the art, event stamps, a darker scan.
 */
export function artDistance(a: ArtSignature, b: ArtSignature): number {
  const r = a.map((block, i) => block.reduce((sum, v, j) => sum + v * b[i]![j]!, 0) / block.length).toSorted((x, y) => x - y);
  const mid = r.length / 2;
  return 1 - (r[mid - 1]! + r[mid]!) / 2;
}
