/**
 * Plaid transaction sync — DB integration (KOI-105/106/107).
 *
 * Pulls a Plaid Item's transaction delta and persists it, leaning on the pure
 * seams for the actual logic:
 *  - `applyTransactionSyncDelta` maps the Plaid response to mutations
 *  - `classifyFlow` sets income/expense/transfer
 *  - `resolveCategory` assigns a new transaction's category: the matching
 *    Category Rule, else the Default Category from the Bank Category mapping
 *    (seeded with the categories on a new user's first sync)
 *  - `matchInternalTransfers` links transfer legs via `transferPairId`
 *
 * Accounts the app has no row for (opened after linking, or shared during a
 * reconnect) are created first, unless the user removed them (KOI-317). Their
 * transactions were skipped by earlier syncs while the cursor moved on, so
 * adding one re-pulls the bank's history from the start; the upserts below keep
 * that safe to repeat.
 *
 * Idempotent: transactions upsert on the unique Plaid id, snapshots upsert on
 * (account, day), the cursor advances only after a successful drain. A re-run
 * converges to the same state.
 */
import { randomUUID } from "node:crypto";

import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@life-tracker/db";
import {
  financialAccount,
  plaidItem,
  transaction,
} from "@life-tracker/db/schema/index";

import { decryptToken } from "./token-encryption";
import { todayUtc } from "./date-utils";
import { plaidAccountToRow, type PlaidAccountInput } from "./plaid-account-map";
import { persistAccountBalances } from "./plaid-balance-db";
import { describePlaidError, getPlaidClient, getTokenEncryptionKey } from "./plaid-client";
import { foreignPlaidEnvError } from "./plaid-env";
import {
  type PlaidSyncDelta,
  type PlaidTransactionInput,
  accountBalanceMutations,
  accountIdsByPlaid,
  applyTransactionSyncDelta,
} from "./plaid-sync-transform";
import { classifyFlow, matchInternalTransfers } from "./transaction-flow";
import { resolveCategory } from "./category-rules";
import { ensureSeeded, loadMatchableRules } from "./category-rules-db";

const TRANSFER_MATCH_WINDOW_DAYS = 3;

/** Drain the full Plaid sync pagination for one item. */
async function fetchSyncDelta(
  accessToken: string,
  startCursor: string | null,
): Promise<{ delta: PlaidSyncDelta; nextCursor: string }> {
  const plaid = getPlaidClient();
  const added: PlaidTransactionInput[] = [];
  const modified: PlaidTransactionInput[] = [];
  const removed: Array<{ transaction_id: string }> = [];

  let cursor = startCursor ?? undefined;
  let hasMore = true;
  while (hasMore) {
    const res = await plaid.transactionsSync({ access_token: accessToken, cursor });
    added.push(...(res.data.added as unknown as PlaidTransactionInput[]));
    modified.push(...(res.data.modified as unknown as PlaidTransactionInput[]));
    removed.push(...res.data.removed.map((r) => ({ transaction_id: r.transaction_id })));
    cursor = res.data.next_cursor;
    hasMore = res.data.has_more;
  }

  return { delta: { added, modified, removed }, nextCursor: cursor ?? "" };
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
  // Every sync path (webhook, drain, initial sync, syncNow, repair) lands here.
  const foreignEnv = foreignPlaidEnvError(item.plaidEnv);
  if (foreignEnv) throw new Error(foreignEnv);

  const userId = item.userId;
  const accessToken = decryptToken(item.accessTokenEnc, getTokenEncryptionKey());

  // Every account at the bank (`/accounts/get`), not just those with
  // transactions in the delta: add the unknown ones now, refresh balances +
  // today's snapshot below. A failed `/accounts/get` must not block
  // transaction ingestion; the next sync or the daily job catches up.
  let plaidAccounts: PlaidAccountInput[] = [];
  let startCursor = item.transactionCursor;
  try {
    plaidAccounts = (await getPlaidClient().accountsGet({ access_token: accessToken })).data.accounts;
    if (await addUnknownAccounts(item, plaidAccounts)) startCursor = null;
  } catch (err) {
    console.error(
      `[plaid] account refresh failed for plaid_item ${plaidItemId}:`,
      describePlaidError(err),
    );
  }

  const { delta, nextCursor } = await fetchSyncDelta(accessToken, startCursor);
  const mutations = applyTransactionSyncDelta(delta);

  // Resolve Plaid account ids → our financial_account ids for FK wiring.
  const accounts = await db
    .select({ id: financialAccount.id, plaidAccountId: financialAccount.plaidAccountId })
    .from(financialAccount)
    .where(eq(financialAccount.userId, userId));
  const accountIdByPlaid = accountIdsByPlaid(accounts);

  try {
    await persistAccountBalances(
      userId,
      accountIdByPlaid,
      accountBalanceMutations(plaidAccounts, todayUtc()),
    );
  } catch (err) {
    console.error(`[plaid] balance capture failed for plaid_item ${plaidItemId}:`, err);
  }

  const mapping = await ensureSeeded(db, userId);
  const rules = await loadMatchableRules(db, userId);

  // Transaction upserts — fold in flow classification + category resolution.
  // The category only applies on insert: a known transaction keeps its own.
  for (const up of mutations.upserts) {
    const accountId = accountIdByPlaid.get(up.plaidAccountId);
    if (!accountId) continue;
    const flow = classifyFlow(up.plaidCategoryPrimary);
    const categoryId = resolveCategory(up.name, up.plaidCategoryPrimary, rules, mapping);
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
          // A user override wins over Plaid's re-classification (ADR 0001).
          flow: sql`case when ${transaction.flowOverridden} then ${transaction.flow} else excluded.flow end`,
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

  // A successful sync proves an errored login works again. Other statuses
  // (e.g. pending_expiration) still need user action — leave them to ITEM
  // webhooks so the reconnect banner isn't silently cleared.
  // Compare-and-set: an overlapping sync that moved the cursor (or reset it to
  // re-pull history for an added account) wins; this one's upserts are idempotent.
  await db
    .update(plaidItem)
    .set({
      transactionCursor: nextCursor,
      status: sql`case when ${plaidItem.status} = 'error' then 'active' else ${plaidItem.status} end`,
    })
    .where(
      and(
        eq(plaidItem.id, plaidItemId),
        sql`${plaidItem.transactionCursor} is not distinct from ${startCursor}`,
      ),
    );

  return {
    added: delta.added.length,
    modified: delta.modified.length,
    removed: delta.removed.length,
  };
}

/**
 * Create rows for the bank's accounts the app doesn't have, skipping ones the
 * user removed. Adding any clears the item's cursor in the same transaction, so
 * the history re-pull survives a sync that fails after this point (or overlaps
 * it: the final cursor write is compare-and-set). Returns
 * whether any account was added.
 */
async function addUnknownAccounts(
  item: { id: string; userId: string; removedPlaidAccountIds: string[] },
  plaidAccounts: PlaidAccountInput[],
): Promise<boolean> {
  const rows = plaidAccounts
    .filter((a) => !item.removedPlaidAccountIds.includes(a.account_id))
    .map((a) => ({ id: randomUUID(), ...plaidAccountToRow(a, { userId: item.userId, plaidItemId: item.id }) }));
  if (rows.length === 0) return false;

  return db.transaction(async (tx) => {
    const added = await tx
      .insert(financialAccount)
      .values(rows)
      .onConflictDoNothing({ target: financialAccount.plaidAccountId })
      .returning({ id: financialAccount.id });
    if (added.length === 0) return false;
    await tx.update(plaidItem).set({ transactionCursor: null }).where(eq(plaidItem.id, item.id));
    return true;
  });
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
