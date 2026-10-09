/**
 * Category Rules — DB integration (KOI-298/299). Loads what the pure matching
 * in `category-rules.ts` needs and writes retroactive recategorizations. Sync,
 * reset and the rules router share these so they resolve identically.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@life-tracker/db";
import { category, categoryRule, transaction } from "@life-tracker/db/schema/index";

import {
  type CandidateRule,
  type CategorizableTransaction,
  type MatchableRule,
  type Recategorization,
  ruleRecategorizations,
} from "./category-rules";

type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Conn = Db | Tx;

/** Ids per UPDATE, well under Postgres' bind-parameter limit. */
const UPDATE_CHUNK = 1000;

export function loadMatchableRules(conn: Conn, userId: string): Promise<MatchableRule[]> {
  return conn
    .select({
      id: categoryRule.id,
      pattern: categoryRule.pattern,
      categoryId: categoryRule.categoryId,
      createdAt: categoryRule.createdAt,
    })
    .from(categoryRule)
    .where(eq(categoryRule.userId, userId));
}

export async function loadCategoryByName(conn: Conn, userId: string): Promise<Map<string, string>> {
  const rows = await conn
    .select({ id: category.id, name: category.name })
    .from(category)
    .where(eq(category.userId, userId));
  return new Map(rows.map((r) => [r.name, r.id]));
}

/** The user's transactions without a Manual Category — the only ones rules may touch (ADR 0004). */
export function loadAutomaticTransactions(conn: Conn, userId: string): Promise<CategorizableTransaction[]> {
  return conn
    .select({
      id: transaction.id,
      name: transaction.name,
      plaidCategoryPrimary: transaction.plaidCategoryPrimary,
      categoryId: transaction.categoryId,
    })
    .from(transaction)
    .where(and(eq(transaction.userId, userId), eq(transaction.categoryOverridden, false)));
}

/** Non-manual transactions whose category changes once `candidate` is saved against `rules`. */
export async function planRuleApply(
  conn: Conn,
  userId: string,
  rules: readonly MatchableRule[],
  candidate: CandidateRule,
): Promise<Recategorization[]> {
  const categoryByName = await loadCategoryByName(conn, userId);
  const rows = await loadAutomaticTransactions(conn, userId);
  return ruleRecategorizations(rows, rules, candidate, categoryByName);
}

/**
 * Write recategorizations: one UPDATE per target category (chunked), scoped to
 * the user and re-checking the manual flag so a concurrent hand-pick wins.
 * Returns how many transactions were actually updated.
 */
export async function applyRecategorizations(
  conn: Conn,
  userId: string,
  changes: readonly Recategorization[],
): Promise<number> {
  let updated = 0;
  const idsByCategory = new Map<string | null, string[]>();
  for (const c of changes) {
    const ids = idsByCategory.get(c.categoryId) ?? [];
    ids.push(c.id);
    idsByCategory.set(c.categoryId, ids);
  }
  for (const [categoryId, ids] of idsByCategory) {
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      const result = await conn
        .update(transaction)
        .set({ categoryId })
        .where(
          and(
            eq(transaction.userId, userId),
            eq(transaction.categoryOverridden, false),
            inArray(transaction.id, ids.slice(i, i + UPDATE_CHUNK)),
          ),
        );
      updated += result.rowCount ?? 0;
    }
  }
  return updated;
}
