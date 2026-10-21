/**
 * Category resolution for transactions (KOI-295): Default Category, Manual
 * Category and Rules. Pure — matching never lives in SQL, so sync,
 * reset, retroactive apply and remapping all share these functions.
 */

/** The user's Bank Category mapping (KOI-335): Bank Category → category id, null when unmapped. */
export type BankCategoryMapping = ReadonlyMap<string, string | null>;

/**
 * The Default Category: the category the user mapped the Bank Category (Plaid
 * primary) to, or null (Uncategorized) when it is unmapped or unknown.
 */
export function defaultCategoryId(
  plaidCategoryPrimary: string | null | undefined,
  mapping: BankCategoryMapping,
): string | null {
  return plaidCategoryPrimary ? (mapping.get(plaidCategoryPrimary) ?? null) : null;
}

/**
 * Backfill inference (ADR 0004): a category is manual when it differs from the
 * Default Category. A hand-pick equal to the default reads as automatic, which
 * is harmless.
 */
export function isManualCategory(
  categoryId: string | null,
  plaidCategoryPrimary: string | null | undefined,
  mapping: BankCategoryMapping,
): boolean {
  return categoryId !== defaultCategoryId(plaidCategoryPrimary, mapping);
}

/**
 * How a Rule's Pattern matches: the whole trimmed description, or any part of
 * it. Mirrors `ruleMatchModeEnum` in the db schema, kept apart so the web app
 * can import this file without the db package.
 */
export const MATCH_MODES = ["exact", "contains"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

/** Both match modes ignore accents and case: "Café" and "CAFE" are the same. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** The fields of a Rule that matching needs. */
export interface MatchableRule {
  id: string;
  pattern: string;
  matchMode: MatchMode;
  categoryId: string;
  createdAt: Date;
}

/** Whether one rule matches a bank description, in its own mode. */
function matches(rule: Pick<MatchableRule, "pattern" | "matchMode">, name: string): boolean {
  return rule.matchMode === "exact" ? fold(name.trim()) === fold(rule.pattern) : fold(name).includes(fold(rule.pattern));
}

/**
 * The Rule for a bank description. An exact match beats any contains match;
 * then the longest Pattern wins, then the newest rule, then the highest id,
 * so the winner never depends on input order. Null when none match.
 */
export function matchRule<R extends MatchableRule>(name: string, rules: readonly R[]): R | null {
  let best: R | null = null;
  for (const r of rules) {
    if (matches(r, name) && (!best || outranks(r, best))) best = r;
  }
  return best;
}

function outranks(a: MatchableRule, b: MatchableRule): boolean {
  if (a.matchMode !== b.matchMode) return a.matchMode === "exact";
  if (a.pattern.length !== b.pattern.length) return a.pattern.length > b.pattern.length;
  if (+a.createdAt !== +b.createdAt) return a.createdAt > b.createdAt;
  return a.id > b.id;
}

/** Automatic category: the matching rule's, else the Default Category. */
export function resolveCategory(
  name: string,
  plaidCategoryPrimary: string | null | undefined,
  rules: readonly MatchableRule[],
  mapping: BankCategoryMapping,
): string | null {
  return matchRule(name, rules)?.categoryId ?? defaultCategoryId(plaidCategoryPrimary, mapping);
}

export const MIN_PATTERN_LENGTH = 3;
export const MAX_PATTERN_LENGTH = 100;
export const DUPLICATE_PATTERN_REASON = "A rule with this pattern already exists";

export type PatternValidation = { ok: true; pattern: string } | { ok: false; reason: string };

/**
 * A Pattern must be 3 to 100 characters once trimmed and unique per user and
 * match mode, ignoring case and accents. On edit, a rule may keep its own pattern.
 */
export function validatePattern(
  pattern: string,
  matchMode: MatchMode,
  existing: ReadonlyArray<{ id: string; pattern: string; matchMode: MatchMode }>,
  editingRuleId?: string,
): PatternValidation {
  const trimmed = pattern.trim();
  if (trimmed.length < MIN_PATTERN_LENGTH) {
    return { ok: false, reason: `Pattern must be at least ${MIN_PATTERN_LENGTH} characters` };
  }
  if (trimmed.length > MAX_PATTERN_LENGTH) {
    return { ok: false, reason: `Pattern must be at most ${MAX_PATTERN_LENGTH} characters` };
  }
  const key = fold(trimmed);
  if (existing.some((r) => r.id !== editingRuleId && r.matchMode === matchMode && fold(r.pattern) === key)) {
    return { ok: false, reason: DUPLICATE_PATTERN_REASON };
  }
  return { ok: true, pattern: trimmed };
}

/** A rule about to be saved: new (with the DB's createdAt once inserted) or an edit of an existing id. */
export interface CandidateRule {
  id: string;
  pattern: string;
  matchMode: MatchMode;
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
  const { id, pattern, matchMode, categoryId } = candidate;
  const edited = rules.find((r) => r.id === id);
  if (!edited) return [...rules, { id, pattern, matchMode, categoryId, createdAt: candidate.createdAt ?? new Date() }];
  return rules.map((r) => (r === edited ? { id, pattern, matchMode, categoryId, createdAt: r.createdAt } : r));
}

export interface CategorizableTransaction {
  id: string;
  name: string;
  plaidCategoryPrimary: string | null;
  categoryId: string | null;
  /** Manual Category flag; only blank (Uncategorized) manual rows can be filled. */
  categoryOverridden?: boolean;
}

/**
 * Retroactive apply of one rule: only rows it matches (or, on edit, its
 * previous Pattern and mode matched) are re-resolved, against the full rule set as
 * if the rule were saved; returns those whose category changes. Rows a deleted
 * rule once categorized stay as they are — applying is one-shot, never a sweep
 * (ADR 0004). A Manual Category is never changed, except that a matching rule
 * fills a blank one (Uncategorized); falling back to the Default Category
 * never does.
 */
export function ruleRecategorizations(
  rows: readonly CategorizableTransaction[],
  rules: readonly MatchableRule[],
  candidate: CandidateRule,
  mapping: BankCategoryMapping,
): Recategorization[] {
  const previous = rules.find((r) => r.id === candidate.id);
  const touched = rows.filter((row) => matches(candidate, row.name) || (previous && matches(previous, row.name)));
  const saved = withCandidateRule(rules, candidate);
  return touched.flatMap((row) => {
    if (row.categoryOverridden) {
      const rule = row.categoryId === null ? matchRule(row.name, saved) : null;
      return rule ? [{ id: row.id, categoryId: rule.categoryId }] : [];
    }
    const categoryId = resolveCategory(row.name, row.plaidCategoryPrimary, saved, mapping);
    return categoryId === row.categoryId ? [] : [{ id: row.id, categoryId }];
  });
}

/**
 * Remap (KOI-335): re-resolve automatic rows against a changed Bank Category
 * mapping; returns those whose category changes. Rules still win, and a Manual
 * Category (blank or not) is never touched.
 */
export function bankCategoryRecategorizations(
  rows: readonly CategorizableTransaction[],
  rules: readonly MatchableRule[],
  mapping: BankCategoryMapping,
): Recategorization[] {
  return rows.flatMap((row) => {
    if (row.categoryOverridden) return [];
    const categoryId = resolveCategory(row.name, row.plaidCategoryPrimary, rules, mapping);
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
  if (merchant && fold(name).includes(fold(merchant))) return merchant;
  return name.trim().slice(0, MAX_PATTERN_LENGTH);
}
