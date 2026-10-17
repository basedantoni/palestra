/**
 * Category colors (KOI-336). A top-level category stores one of these palette
 * tokens; the hex for each mode lives only in `apps/web/src/index.css` as
 * `--chart-cat-<token>`. The order is the dataviz-validated categorical order
 * (every adjacent pair clears the CVD and normal-vision gates in both modes),
 * and it is the order new categories and the seed take colors in.
 */
export const CATEGORY_COLORS = [
  "blue",
  "orange",
  "aqua",
  "yellow",
  "magenta",
  "violet",
  "brown",
  "purple",
  "olive",
  "sky",
  "red",
  "plum",
  "green",
] as const;

export type CategoryColor = (typeof CATEGORY_COLORS)[number];

/** How far (percent) a Subcategory's tint mixes its parent's color toward the card surface, by sibling. */
const TINT_STEPS = [25, 40, 55, 70];

/**
 * The most a token can mix toward the card surface and still hold 1.5:1
 * against it in both modes (computed in OKLab; `category-colors.test.ts`
 * re-derives it from index.css). Light yellow starts at 2.2:1, so it caps
 * lowest.
 */
export const TINT_CAP: Record<CategoryColor, number> = {
  blue: 68,
  orange: 61,
  aqua: 57,
  yellow: 44,
  magenta: 55,
  violet: 70,
  brown: 58,
  purple: 57,
  olive: 66,
  sky: 55,
  red: 66,
  plum: 59,
  green: 61,
};

/**
 * The percent a Subcategory's tint mixes `parent` toward the surface: 25 / 40
 * / 55 / 70 by sibling order, wrapping after 4, scaled down for a token whose
 * cap is under 70 so siblings stay distinct and the faintest still passes.
 * Render with `color-mix(in oklab, <parent> , <surface> <percent>%)`.
 */
export function subcategoryTint(parent: CategoryColor, siblingIndex: number): number {
  const step = TINT_STEPS[siblingIndex % TINT_STEPS.length]!;
  return Math.round((step * TINT_CAP[parent]) / TINT_STEPS.at(-1)!);
}

/** The color a new category gets: the least-used token, earliest in palette order on a tie. */
export function nextCategoryColor(used: readonly (string | null)[]): CategoryColor {
  const count = (c: CategoryColor) => used.filter((u) => u === c).length;
  return CATEGORY_COLORS.reduce((best, c) => (count(c) < count(best) ? c : best));
}
