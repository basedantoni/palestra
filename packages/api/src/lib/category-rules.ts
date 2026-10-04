/**
 * Category resolution for transactions (KOI-295): Default and Manual Category
 * today, Category Rules next. Pure: sync, the transactions router and the
 * Manual Category backfill all call this.
 */
import { categoryNameForPfc } from "./category-seed";

/** The Default Category: the user's seeded category for the Plaid primary category. */
export function defaultCategoryId(
  plaidCategoryPrimary: string | null | undefined,
  categoryByName: ReadonlyMap<string, string>,
): string | null {
  return categoryByName.get(categoryNameForPfc(plaidCategoryPrimary)) ?? null;
}

/**
 * Backfill inference (ADR 0004): a category is manual when it differs from the
 * Default Category. A hand-pick equal to the default reads as automatic, which
 * is harmless.
 */
export function isManualCategory(
  categoryId: string | null,
  plaidCategoryPrimary: string | null | undefined,
  categoryByName: ReadonlyMap<string, string>,
): boolean {
  return categoryId !== defaultCategoryId(plaidCategoryPrimary, categoryByName);
}
