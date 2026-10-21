/**
 * Category and flow resolution for transactions (KOI-295, KOI-340): Default
 * Category, Manual Category and Rules. Pure — matching never lives in SQL, so
 * sync, reset, retroactive apply and remapping all share these functions.
 */
import { type TransactionFlow, classifyFlow } from "./transaction-flow";

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

/** The fields of a Rule that matching needs. A rule sets a category, a flow, or both. */
export interface MatchableRule {
  id: string;
  pattern: string;
  matchMode: MatchMode;
  categoryId: string | null;
  setFlow: TransactionFlow | null;
  createdAt: Date;
}

/** What a Rule can set; each resolves on its own, among the rules that set it. */
export type RuleField = "categoryId" | "setFlow";

/** Whether one rule matches a bank description, in its own mode. */
function matches(rule: Pick<MatchableRule, "pattern" | "matchMode">, name: string): boolean {
  return rule.matchMode === "exact" ? fold(name.trim()) === fold(rule.pattern) : fold(name).includes(fold(rule.pattern));
}

/**
 * The Rule that sets `field` for a bank description; rules that don't set it
 * are ignored, so a flow-only rule never blocks a category. An exact match
 * beats any contains match; then the longest Pattern wins, then the newest
 * rule, then the highest id, so the winner never depends on input order. Null
 * when none match.
 */
export function matchRule<R extends MatchableRule>(name: string, rules: readonly R[], field: RuleField): R | null {
  let best: R | null = null;
  for (const r of rules) {
    if (r[field] !== null && matches(r, name) && (!best || outranks(r, best))) best = r;
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
  return matchRule(name, rules, "categoryId")?.categoryId ?? defaultCategoryId(plaidCategoryPrimary, mapping);
}

/** What decides whether a transaction's flow is a Rule's to set. */
export interface FlowLock {
  flowOverridden: boolean;
  transferPairId: string | null;
}

/** A hand-set flow (ADR 0001) and a Transfer Pair's legs are never a Rule's to change. */
export function isFlowLocked(row: FlowLock): boolean {
  return row.flowOverridden || row.transferPairId !== null;
}

/**
 * Automatic flow: the matching flow rule's, else `baseFlow` (the bank's
 * classification). A locked row gets no rule: `baseFlow` comes back.
 */
export function resolveFlow(
  baseFlow: TransactionFlow,
  name: string,
  rules: readonly MatchableRule[],
  row: FlowLock,
): TransactionFlow {
  if (isFlowLocked(row)) return baseFlow;
  return matchRule(name, rules, "setFlow")?.setFlow ?? baseFlow;
}

/**
 * Why a Rule can't set this flow and category, or null when it can: it must
 * set at least one, and an income or transfer rule sets no category.
 */
export function ruleTargetsError(setFlow: TransactionFlow | null, categoryId: string | null): string | null {
  if (setFlow === null && categoryId === null) return "A rule must set a flow, a category, or both";
  if (categoryId !== null && setFlow !== null && setFlow !== "expense") return "Income and transfer rules set no category";
  return null;
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
  categoryId: string | null;
  setFlow: TransactionFlow | null;
  createdAt?: Date;
}

/** A transaction's automatic changes: only the fields that change are present. */
export interface Recategorization {
  id: string;
  categoryId?: string | null;
  flow?: TransactionFlow;
}

/**
 * The user's rule set as if `candidate` were saved: an edit replaces the rule
 * with the same id (keeping its createdAt, as the DB does), a new rule joins
 * as the newest.
 */
export function withCandidateRule(rules: readonly MatchableRule[], candidate: CandidateRule): MatchableRule[] {
  const { id, pattern, matchMode, categoryId, setFlow } = candidate;
  const edited = rules.find((r) => r.id === id);
  if (!edited) {
    return [...rules, { id, pattern, matchMode, categoryId, setFlow, createdAt: candidate.createdAt ?? new Date() }];
  }
  return rules.map((r) => (r === edited ? { id, pattern, matchMode, categoryId, setFlow, createdAt: r.createdAt } : r));
}

export interface CategorizableTransaction extends FlowLock {
  id: string;
  name: string;
  plaidCategoryPrimary: string | null;
  categoryId: string | null;
  flow: TransactionFlow | null;
  /** Manual Category flag; only blank (Uncategorized) manual rows can be filled. */
  categoryOverridden?: boolean;
}

/**
 * Retroactive apply of one rule: only rows it matches (or, on edit, its
 * previous Pattern and mode matched) are re-resolved, against the full rule set as
 * if the rule were saved; returns those whose category or flow changes. Rows a
 * deleted rule once changed stay as they are — applying is one-shot, never a
 * sweep (ADR 0004). A Manual Category is never changed, except that a matching
 * rule fills a blank one (Uncategorized); falling back to the Default Category
 * never does. Flow re-resolves from the bank's classification, except on a
 * locked row (`isFlowLocked`).
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
    const change: Recategorization = { id: row.id };
    // undefined: the category stays (a Manual Category takes only a rule's, and only when blank).
    const categoryId = !row.categoryOverridden
      ? resolveCategory(row.name, row.plaidCategoryPrimary, saved, mapping)
      : row.categoryId === null
        ? matchRule(row.name, saved, "categoryId")?.categoryId
        : undefined;
    if (categoryId !== undefined && categoryId !== row.categoryId) change.categoryId = categoryId;
    const flow = resolveFlow(classifyFlow(row.plaidCategoryPrimary), row.name, saved, row);
    if (!isFlowLocked(row) && flow !== row.flow) change.flow = flow;
    return "categoryId" in change || "flow" in change ? [change] : [];
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
