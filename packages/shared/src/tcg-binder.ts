/** Pockets on one binder sheet: 3 × 3, like a physical 9-pocket page. */
const BINDER_POCKETS = 9;

/** One sheet of the binder: its page of the whole binder, and its pockets, `null` where empty. */
export function binderSheet<T>(artworks: readonly T[], requested: number) {
  const pages = Math.max(1, Math.ceil(artworks.length / BINDER_POCKETS));
  const page = Math.min(requested, pages);
  const start = (page - 1) * BINDER_POCKETS;
  const pockets = Array.from({ length: BINDER_POCKETS }, (_, i) => artworks[start + i] ?? null);
  return { page, pages, pockets };
}
