/**
 * Category Rules — DB integration (KOI-298/299). Loads what the pure matching
 * in `category-rules.ts` needs and writes retroactive recategorizations. Sync,
 * reset, the rules router and Bank Category remapping share these so they
 * resolve identically.
 */
import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { type SQL, and, eq, inArray, isNull, or } from "drizzle-orm";

import { db } from "@life-tracker/db";
import { bankCategoryMapping, category, categoryRule, transaction } from "@life-tracker/db/schema/index";

import {
  type BankCategoryMapping,
  type CandidateRule,
  type CategorizableTransaction,
  type MatchableRule,
  type Recategorization,
  ruleRecategorizations,
} from "./category-rules";
import { SEED_CATEGORIES, seedBankCategoryMapping, seedCategoryColor, seedCategoryIcon } from "./category-seed";

type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Conn = Db | Tx;

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

/**
 * The user's category, else NOT_FOUND with `message`. Seeded ones are as
 * editable as custom ones: the Bank Category mapping holds them by id, not
 * name (KOI-335).
 */
export async function ownedCategory(
  conn: Conn,
  userId: string,
  id: string,
  message = "Category not found",
): Promise<{ id: string; parentId: string | null; color: string | null }> {
  const [row] = await conn
    .select({ id: category.id, parentId: category.parentId, color: category.color })
    .from(category)
    .where(and(eq(category.id, id), eq(category.userId, userId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message });
  return row;
}

export async function loadCategoryByName(conn: Conn, userId: string): Promise<Map<string, string>> {
  const rows = await conn
    .select({ id: category.id, name: category.name })
    .from(category)
    .where(eq(category.userId, userId));
  return new Map(rows.map((r) => [r.name, r.id]));
}

/**
 * The user's Bank Category mapping (KOI-335); a Bank Category with no row is
 * unmapped. Every reader (sync, reset, rules, remapping) goes through here, so
 * a user with no mapping rows gets them written first: one with categories
 * (seeded before KOI-335) is mapped by name, keeping their categories as they
 * are, so a seeded category they renamed or deleted is never re-created; only
 * a user with no categories at all gets the seed categories too.
 */
export async function loadBankCategoryMapping(conn: Conn, userId: string): Promise<BankCategoryMapping> {
  const rows = await conn
    .select({ pfcPrimary: bankCategoryMapping.pfcPrimary, categoryId: bankCategoryMapping.categoryId })
    .from(bankCategoryMapping)
    .where(eq(bankCategoryMapping.userId, userId));
  if (rows.length > 0) return new Map(rows.map((r) => [r.pfcPrimary, r.categoryId]));
  if ((await loadCategoryByName(conn, userId)).size === 0) {
    await conn
      .insert(category)
      .values(
        SEED_CATEGORIES.map((name, sortOrder) => ({
          id: randomUUID(),
          userId,
          name,
          isSystem: true,
          color: seedCategoryColor(name),
          icon: seedCategoryIcon(name),
          sortOrder,
        })),
      )
      .onConflictDoNothing();
  }
  return writeSeedMapping(conn, userId);
}

/**
 * Map every Bank Category to the user's category of its seed name, keeping any
 * row that already exists (so a user's own mapping survives). Idempotent: the
 * lazy seed, the dev seed and the KOI-335 backfill all use it. Returns the
 * name-based mapping.
 */
export async function writeSeedMapping(conn: Conn, userId: string): Promise<BankCategoryMapping> {
  const seeded = seedBankCategoryMapping(await loadCategoryByName(conn, userId));
  await conn
    .insert(bankCategoryMapping)
    .values([...seeded].map(([pfcPrimary, categoryId]) => ({ userId, pfcPrimary, categoryId })))
    .onConflictDoNothing();
  return seeded;
}

/** What the pure recategorizations read of a transaction. */
const categorizableColumns = {
  id: transaction.id,
  name: transaction.name,
  plaidCategoryPrimary: transaction.plaidCategoryPrimary,
  categoryId: transaction.categoryId,
  categoryOverridden: transaction.categoryOverridden,
};

/**
 * The user's rows of one Bank Category, for remapping it. Manual ones included:
 * `bankCategoryRecategorizations` skips them, and `remapMayCategorize` guards the write.
 */
export function loadBankCategoryTransactions(
  conn: Conn,
  userId: string,
  bankCategory: string,
): Promise<CategorizableTransaction[]> {
  return conn
    .select(categorizableColumns)
    .from(transaction)
    .where(and(eq(transaction.userId, userId), eq(transaction.plaidCategoryPrimary, bankCategory)));
}

/** A rule may set these: automatic, or a blank (Uncategorized) Manual Category (ADR 0004). */
const ruleMayCategorize = or(eq(transaction.categoryOverridden, false), isNull(transaction.categoryId));

/**
 * A remap may set only automatic rows; every Manual Category stays (KOI-335).
 * Re-checked in the UPDATE so a hand-pick committed after the rows were read wins.
 */
export const remapMayCategorize = eq(transaction.categoryOverridden, false);

/** The user's transactions a rule may categorize; a hand-picked real category is never loaded. */
export function loadRuleApplicableTransactions(conn: Conn, userId: string): Promise<CategorizableTransaction[]> {
  return conn
    .select(categorizableColumns)
    .from(transaction)
    .where(and(eq(transaction.userId, userId), ruleMayCategorize));
}

/** Non-manual transactions whose category changes once `candidate` is saved against `rules`. */
export async function planRuleApply(
  conn: Conn,
  userId: string,
  rules: readonly MatchableRule[],
  candidate: CandidateRule,
): Promise<Recategorization[]> {
  const mapping = await loadBankCategoryMapping(conn, userId);
  const rows = await loadRuleApplicableTransactions(conn, userId);
  return ruleRecategorizations(rows, rules, candidate, mapping);
}

/**
 * Write recategorizations: one UPDATE per target category, scoped to the user
 * and re-checking eligibility (`mayCategorize`, a rule's by default) so a
 * concurrent hand-pick wins. A filled blank Manual Category becomes automatic.
 * Returns how many transactions were actually updated.
 */
export async function applyRecategorizations(
  conn: Conn,
  userId: string,
  changes: readonly Recategorization[],
  mayCategorize: SQL | undefined = ruleMayCategorize,
): Promise<number> {
  let updated = 0;
  // ponytail: one UPDATE per category, unchunked; chunk the ids if a pattern ever matches >65k rows (bind-param limit).
  for (const [categoryId, group] of Map.groupBy(changes, (c) => c.categoryId)) {
    const result = await conn
      .update(transaction)
      .set({ categoryId, categoryOverridden: false })
      .where(
        and(
          eq(transaction.userId, userId),
          mayCategorize,
          inArray(transaction.id, group.map((c) => c.id)),
        ),
      );
    updated += result.rowCount ?? 0;
  }
  return updated;
}
