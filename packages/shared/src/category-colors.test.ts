import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CATEGORY_COLORS, nextCategoryColor, subcategoryTint, TINT_CAP } from "./category-colors";

// The palette's hexes and the card surface, per mode, read from the web stylesheet.
const css = readFileSync(new URL("../../../apps/web/src/index.css", import.meta.url), "utf8");
const [lightCss, darkCss] = css.split(/^\.dark \{/m) as [string, string];
const hexes = (block: string) =>
  Object.fromEntries([...block.matchAll(/--chart-cat-(\w+): (#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]));
const cardL = (block: string) => Number(block.match(/--card: oklch\(([\d.]+) 0 0\)/)![1]);

type Lab = [number, number, number];
const toLinear = (hex: string) =>
  [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Lab;
function oklab([r, g, b]: Lab): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function luminanceOfLab([L, a, b]: Lab): number {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => Math.min(1, Math.max(0, c)));
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
}
/** WCAG contrast of `hex` mixed `percent` toward an achromatic surface of OKLCH lightness `surfaceL`. */
function tintContrast(hex: string, surfaceL: number, percent: number): number {
  const p = percent / 100;
  const surface: Lab = [surfaceL, 0, 0];
  const tint = oklab(toLinear(hex)).map((v, i) => v * (1 - p) + surface[i]! * p) as Lab;
  const [hi, lo] = [luminanceOfLab(tint), luminanceOfLab(surface)].toSorted((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("category palette", () => {
  it("has a light and a dark var for every token, and nothing else", () => {
    expect(Object.keys(hexes(lightCss)).toSorted()).toEqual([...CATEGORY_COLORS].toSorted());
    expect(Object.keys(hexes(darkCss)).toSorted()).toEqual([...CATEGORY_COLORS].toSorted());
  });

  it.each(CATEGORY_COLORS)("%s: the faintest tint holds 1.5:1 in both modes, and its cap is tight", (token) => {
    const faintest = Math.max(...[0, 1, 2, 3].map((i) => subcategoryTint(token, i)));
    for (const block of [lightCss, darkCss]) {
      expect(tintContrast(hexes(block)[token]!, cardL(block), faintest)).toBeGreaterThanOrEqual(1.5);
    }
    // One more percent fails in some mode, unless the cap is the 70% maximum.
    if (TINT_CAP[token] < 70) {
      const over = [lightCss, darkCss].map((b) => tintContrast(hexes(b)[token]!, cardL(b), TINT_CAP[token] + 1));
      expect(Math.min(...over)).toBeLessThan(1.5);
    }
  });
});

describe("subcategoryTint", () => {
  it("steps 25 / 40 / 55 / 70 for an uncapped token and wraps after 4", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => subcategoryTint("violet", i))).toEqual([25, 40, 55, 70, 25, 40]);
  });

  it("scales the steps under a lower cap, keeping siblings distinct", () => {
    expect([0, 1, 2, 3].map((i) => subcategoryTint("yellow", i))).toEqual([16, 25, 35, 44]);
  });
});

describe("nextCategoryColor", () => {
  it("takes the first token when none are used", () => {
    expect(nextCategoryColor([])).toBe("blue");
  });

  it("takes the least-used token, earliest on a tie, ignoring uncolored rows", () => {
    expect(nextCategoryColor(["blue", "orange", null])).toBe("aqua");
    expect(nextCategoryColor([...CATEGORY_COLORS, "blue"])).toBe("orange");
  });
});
