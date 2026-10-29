import { TCG_CONDITIONS } from "./tcg";

/** Pockets on one binder sheet: 3 × 3, like a physical 9-pocket page. */
const BINDER_POCKETS = 9;

/** An Artwork's Copies sit in its card tile's language order. */
const POCKET_LANGUAGES = ["en", "ja", "zh", "ko"];

type PocketCopy = {
  variantId: string;
  language: string;
  condition: (typeof TCG_CONDITIONS)[number];
  acquiredOn: string;
  createdAt: string;
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The Copies in Pocket order (KOI-379): card number (variant ID), as browse orders Artworks; then
 * language, best Condition, acquired date and when it was added, so an edit never reshuffles them.
 */
export function binderPockets<T extends PocketCopy>(copies: readonly T[]) {
  return copies.toSorted(
    (a, b) =>
      compare(a.variantId, b.variantId) ||
      POCKET_LANGUAGES.indexOf(a.language) - POCKET_LANGUAGES.indexOf(b.language) ||
      TCG_CONDITIONS.indexOf(a.condition) - TCG_CONDITIONS.indexOf(b.condition) ||
      compare(a.acquiredOn, b.acquiredOn) ||
      compare(a.createdAt, b.createdAt),
  );
}

/** One sheet of the binder: its page of the whole binder, and its Pockets, `null` where empty. */
export function binderSheet<T>(copies: readonly T[], requested: number) {
  const pages = Math.max(1, Math.ceil(copies.length / BINDER_POCKETS));
  const page = Math.min(requested, pages);
  const start = (page - 1) * BINDER_POCKETS;
  const pockets = Array.from({ length: BINDER_POCKETS }, (_, i) => copies[start + i] ?? null);
  return { page, pages, pockets };
}
