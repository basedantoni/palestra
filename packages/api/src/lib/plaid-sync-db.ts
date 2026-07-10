/**
 * Plaid transaction sync — DB integration (KOI-105/106/107).
 *
 * Pulls a Plaid Item's transaction delta and persists it, leaning on the pure
 * seams for the actual logic:
 *  - `applyTransactionSyncDelta` maps the Plaid response to mutations
 *  - `classifyFlow` sets income/expense/transfer
 *  - `categoryNameForPfc` + seeded categories auto-assign a category
 *  - `matchInternalTransfers` links transfer legs via `transferPairId`
 *
 * Idempotent: transactions upsert on the unique Plaid id, snapshots upsert on
 * (account, day), the cursor advances only after a successful drain. A re-run
 * converges to the same state.
 */
import { randomUUID } from "node:crypto";

import { and, eq, gte, inArray, isNull } from "drizzle-orm";

import { db } from "@life-tracker/db";
import {
  balanceSnapshot,
  category,
  financialAccount,
  plaidItem,
  transaction,
} from "@life-tracker/db/schema/index";

import { decryptToken } from "./token-encryption";
import { getPlaidClient, getTokenEncryptionKey } from "./plaid-client";
import {
  type PlaidSyncDelta,
  type PlaidTransactionInput,
  applyTransactionSyncDelta,
} from "./plaid-sync-transform";
import { classifyFlow, matchInternalTransfers } from "./transaction-flow";
import { SEED_CATEGORIES, categoryNameForPfc } from "./category-seed";

const TRANSFER_MATCH_WINDOW_DAYS = 3;

/** Ensure the user's seeded categories exist; return a name → id map. */
async function ensureSeedCategories(userId: string): Promise<Map<string, string>> {
  await db
    .insert(category)
    .values(
      SEED_CATEGORIES.map((name) => ({
        id: randomUUID(),
        userId,
        name,
        isSystem: true,
      })),
    )
    .onConflictDoNothing();

  const rows = await db
    .select({ id: category.id, name: category.name })
    .from(category)
    .where(eq(category.userId, userId));
  return new Map(rows.map((r) => [r.name, r.id]));
}

/** Drain the full Plaid sync pagination for one item. */
async function fetchSyncDelta(
  accessToken: string,
  startCursor: string | null,
): Promise<{ delta: Omit<PlaidSyncDelta, "asOfDate">; nextCursor: string }> {
  const plaid = getPlaidClient();
  const added: PlaidTransactionInput[] = [];
  const modified: PlaidTransactionInput[] = [];
  const removed: Array<{ transaction_id: string }> = [];
  const accountsById = new Map<string, PlaidSyncDelta["accounts"][number]>();

  let cursor = startCursor ?? undefined;
  let hasMore = true;
  while (hasMore) {
    const res = await plaid.transactionsSync({ access_token: accessToken, cursor });
    added.push(...(res.data.added as unknown as PlaidTransactionInput[]));
    modified.push(...(res.data.modified as unknown as PlaidTransactionInput[]));
    removed.push(...res.data.removed.map((r) => ({ transaction_id: r.transaction_id })));
    for (const a of res.data.accounts) {
      accountsById.set(a.account_id, a as unknown as PlaidSyncDelta["accounts"][number]);
    }
    cursor = res.data.next_cursor;
    hasMore = res.data.has_more;
  }

  return {
    delta: { added, modified, removed, accounts: [...accountsById.values()] },
    nextCursor: cursor ?? "",
  };
}

export async function syncPlaidItem(plaidItemId: string): Promise<{
  added: number;
  modified: number;
  removed: number;
}> {
  const [item] = await db
    .select()
    .from(plaidItem)
    .where(eq(plaidItem.id, plaidItemId))
    .limit(1);
  if (!item) throw new Error(`plaid_item ${plaidItemId} not found`);

  const userId = item.userId;
  const accessToken = decryptToken(item.accessTokenEnc, getTokenEncryptionKey());
  const { delta, nextCursor } = await fetchSyncDelta(accessToken, item.transactionCursor);
  const asOfDate = new Date().toISOString().slice(0, 10);
  const mutations = applyTransactionSyncDelta({ ...delta, asOfDate });

  // Resolve Plaid account ids → our financial_account ids for FK wiring.
  const accounts = await db
    .select({ id: financialAccount.id, plaidAccountId: financialAccount.plaidAccountId })
    .from(financialAccount)
    .where(eq(financialAccount.userId, userId));
  const accountIdByPlaid = new Map(accounts.map((a) => [a.plaidAccountId, a.id]));

  const categoryByName = await ensureSeedCategories(userId);

  // Account balances + daily snapshots.
  for (const bal of mutations.accountBalances) {
    const accountId = accountIdByPlaid.get(bal.plaidAccountId);
    if (!accountId) continue;
    await db
      .update(financialAccount)
      .set({
        currentBalance: bal.current,
        availableBalance: bal.available,
        isoCurrencyCode: bal.isoCurrencyCode,
      })
      .where(eq(financialAccount.id, accountId));
  }
  for (const snap of mutations.snapshots) {
    const accountId = accountIdByPlaid.get(snap.plaidAccountId);
    if (!accountId) continue;
    await db
      .insert(balanceSnapshot)
      .values({
        id: randomUUID(),
        userId,
        accountId,
        asOfDate: snap.asOfDate,
        balance: snap.balance,
      })
      .onConflictDoUpdate({
        target: [balanceSnapshot.accountId, balanceSnapshot.asOfDate],
        set: { balance: snap.balance },
      });
  }

  // Transaction upserts — fold in flow classification + category seeding.
  for (const up of mutations.upserts) {
    const accountId = accountIdByPlaid.get(up.plaidAccountId);
    if (!accountId) continue;
    const flow = classifyFlow(up.plaidCategoryPrimary);
    const categoryId = categoryByName.get(categoryNameForPfc(up.plaidCategoryPrimary)) ?? null;
    await db
      .insert(transaction)
      .values({
        id: randomUUID(),
        userId,
        accountId,
        plaidTransactionId: up.plaidTransactionId,
        amount: up.amount,
        date: up.date,
        name: up.name,
        merchantName: up.merchantName,
        pending: up.pending,
        flow,
        plaidCategoryPrimary: up.plaidCategoryPrimary,
        plaidCategoryDetailed: up.plaidCategoryDetailed,
        categoryId,
        isoCurrencyCode: up.isoCurrencyCode,
      })
      .onConflictDoUpdate({
        target: transaction.plaidTransactionId,
        set: {
          amount: up.amount,
          date: up.date,
          name: up.name,
          merchantName: up.merchantName,
          pending: up.pending,
          flow,
          plaidCategoryPrimary: up.plaidCategoryPrimary,
          plaidCategoryDetailed: up.plaidCategoryDetailed,
          isoCurrencyCode: up.isoCurrencyCode,
        },
      });
  }

  if (mutations.deletes.length > 0) {
    await db
      .delete(transaction)
      .where(
        and(
          eq(transaction.userId, userId),
          inArray(transaction.plaidTransactionId, mutations.deletes),
        ),
      );
  }

  await linkTransferPairs(userId);

  await db
    .update(plaidItem)
    .set({ transactionCursor: nextCursor, status: "active" })
    .where(eq(plaidItem.id, plaidItemId));

  return {
    added: delta.added.length,
    modified: delta.modified.length,
    removed: delta.removed.length,
  };
}

/**
 * Link internal-transfer legs for a user's recent, still-unpaired transfer
 * transactions. Idempotent: only rows with a null `transferPairId` participate.
 */
async function linkTransferPairs(userId: string): Promise<void> {
  const windowStart = new Date();
  windowStart.setUTCDate(windowStart.getUTCDate() - 30);

  const candidates = await db
    .select({
      id: transaction.id,
      accountId: transaction.accountId,
      amount: transaction.amount,
      date: transaction.date,
    })
    .from(transaction)
    .where(
      and(
        eq(transaction.userId, userId),
        eq(transaction.flow, "transfer"),
        isNull(transaction.transferPairId),
        gte(transaction.date, windowStart),
      ),
    );

  const pairs = matchInternalTransfers(candidates, TRANSFER_MATCH_WINDOW_DAYS);
  for (const pair of pairs) {
    const pairId = randomUUID();
    await db
      .update(transaction)
      .set({ transferPairId: pairId })
      .where(inArray(transaction.id, pair.transactionIds));
  }
}
