/**
 * Category resolution for transactions (KOI-295): Default Category, Manual
 * Category and Category Rules. Pure — matching never lives in SQL, so sync,
 * reset and retroactive apply all share these functions.
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

/** The fields of a Category Rule that matching needs. */
export interface MatchableRule {
  id: string;
  pattern: string;
  categoryId: string;
  createdAt: Date;
}

/**
 * The Category Rule for a bank description: case-insensitive "contains",
 * longest Pattern wins, ties go to the newest rule (then highest id, so the
 * winner never depends on input order). Null when none match.
 */
export function matchRule<R extends MatchableRule>(name: string, rules: readonly R[]): R | null {
  const haystack = name.toLowerCase();
  let best: R | null = null;
  for (const r of rules) {
    if (!haystack.includes(r.pattern.toLowerCase())) continue;
    if (
      !best ||
      r.pattern.length > best.pattern.length ||
      (r.pattern.length === best.pattern.length &&
        (r.createdAt > best.createdAt || (+r.createdAt === +best.createdAt && r.id > best.id)))
    ) {
      best = r;
    }
  }
  return best;
}

/** Automatic category: the matching rule's, else the Default Category. */
export function resolveCategory(
  name: string,
  plaidCategoryPrimary: string | null | undefined,
  rules: readonly MatchableRule[],
  categoryByName: ReadonlyMap<string, string>,
): string | null {
  return matchRule(name, rules)?.categoryId ?? defaultCategoryId(plaidCategoryPrimary, categoryByName);
}

export const MIN_PATTERN_LENGTH = 3;
export const MAX_PATTERN_LENGTH = 100;
export const DUPLICATE_PATTERN_REASON = "A rule with this pattern already exists";

export type PatternValidation = { ok: true; pattern: string } | { ok: false; reason: string };

/**
 * A Pattern must be at least 3 characters once trimmed and unique per user
 * ignoring case. On edit, a rule may keep its own pattern.
 */
export function validatePattern(
  pattern: string,
  existing: ReadonlyArray<{ id: string; pattern: string }>,
  editingRuleId?: string,
): PatternValidation {
  const trimmed = pattern.trim();
  if (trimmed.length < MIN_PATTERN_LENGTH) {
    return { ok: false, reason: `Pattern must be at least ${MIN_PATTERN_LENGTH} characters` };
  }
  const lower = trimmed.toLowerCase();
  if (existing.some((r) => r.id !== editingRuleId && r.pattern.toLowerCase() === lower)) {
    return { ok: false, reason: DUPLICATE_PATTERN_REASON };
  }
  return { ok: true, pattern: trimmed };
}

/** A rule about to be saved: new (with the DB's createdAt once inserted) or an edit of an existing id. */
export interface CandidateRule {
  id: string;
  pattern: string;
  categoryId: string;
  createdAt?: Date;
}

export interface Recategorization {
  id: string;
  categoryId: string | null;
}

/**
 * The user's rule set as if `candidate` were saved: an edit replaces the rule
 * with the same id (keeping its createdAt, as the DB does), a new rule joins
 * as the newest.
 */
export function withCandidateRule(rules: readonly MatchableRule[], candidate: CandidateRule): MatchableRule[] {
  const { id, pattern, categoryId } = candidate;
  const edited = rules.find((r) => r.id === id);
  if (!edited) return [...rules, { id, pattern, categoryId, createdAt: candidate.createdAt ?? new Date() }];
  return rules.map((r) => (r === edited ? { id, pattern, categoryId, createdAt: r.createdAt } : r));
}

export interface CategorizableTransaction {
  id: string;
  name: string;
  plaidCategoryPrimary: string | null;
  categoryId: string | null;
}

/**
 * Retroactive apply of one rule: only rows its Pattern matches (or, on edit,
 * its previous Pattern matched) are re-resolved, against the full rule set as
 * if the rule were saved; returns those whose category changes. Rows a deleted
 * rule once categorized stay as they are — applying is one-shot, never a sweep
 * (ADR 0004). Callers pass non-manual rows only.
 */
export function ruleRecategorizations(
  rows: readonly CategorizableTransaction[],
  rules: readonly MatchableRule[],
  candidate: CandidateRule,
  categoryByName: ReadonlyMap<string, string>,
): Recategorization[] {
  const previous = rules.find((r) => r.id === candidate.id);
  const patterns = [candidate.pattern, previous?.pattern].flatMap((p) => (p ? [p.toLowerCase()] : []));
  const touched = rows.filter((row) => {
    const name = row.name.toLowerCase();
    return patterns.some((p) => name.includes(p));
  });
  const saved = withCandidateRule(rules, candidate);
  return touched.flatMap((row) => {
    const categoryId = resolveCategory(row.name, row.plaidCategoryPrimary, saved, categoryByName);
    return categoryId === row.categoryId ? [] : [{ id: row.id, categoryId }];
  });
}

/**
 * Pattern offered after a recategorize: the merchant when the description
 * contains it, else the description cut to a savable length (a prefix still
 * matches the transaction it came from).
 */
export function suggestPattern(name: string, merchantName: string | null): string {
  const merchant = merchantName?.trim();
  if (merchant && name.toLowerCase().includes(merchant.toLowerCase())) return merchant;
  return name.trim().slice(0, MAX_PATTERN_LENGTH);
}
