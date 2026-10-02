/**
 * Daily balance snapshot job (KOI-289, ADR 0003).
 *
 * Plaid only reports current balances, so net worth history can't be
 * backfilled — a day not captured is lost. A daily GitHub Actions cron hits
 * `POST /api/internal/plaid/snapshot-balances`, which calls this to record one
 * balance snapshot per account for today.
 *
 * Uses `/accounts/get` (free, cached ~daily), never `/accounts/balance/get`
 * (billed per call). Idempotent per day via the (account, day) upsert.
 */
import { eq, ne } from "drizzle-orm";

import { db } from "@life-tracker/db";
import { financialAccount, plaidItem } from "@life-tracker/db/schema/index";

import { todayUtc } from "./date-utils";
import { persistAccountBalances } from "./plaid-balance-db";
import { describePlaidError, getPlaidClient, getTokenEncryptionKey } from "./plaid-client";
import { accountBalanceMutations } from "./plaid-sync-transform";
import { decryptToken } from "./token-encryption";

export interface SnapshotBalancesResult {
  /** Items whose accounts were snapshotted. */
  snapshotted: number;
  /** Items that errored (logged and skipped). */
  failed: number;
}

async function snapshotItem(
  item: { id: string; userId: string; accessTokenEnc: string },
  asOfDate: string,
): Promise<void> {
  const accessToken = decryptToken(item.accessTokenEnc, getTokenEncryptionKey());
  const res = await getPlaidClient().accountsGet({ access_token: accessToken });
  const mutations = accountBalanceMutations(res.data.accounts, asOfDate);

  const accounts = await db
    .select({ id: financialAccount.id, plaidAccountId: financialAccount.plaidAccountId })
    .from(financialAccount)
    .where(eq(financialAccount.plaidItemId, item.id));
  const accountIdByPlaid = new Map(accounts.map((a) => [a.plaidAccountId, a.id]));

  await persistAccountBalances(item.userId, accountIdByPlaid, mutations);
}

/**
 * Snapshot today's balance for every account on every non-revoked Plaid item.
 * One item failing (e.g. ITEM_LOGIN_REQUIRED) is logged and counted; it never
 * aborts the rest.
 */
export async function snapshotAllPlaidBalances(
  asOfDate: string = todayUtc(),
): Promise<SnapshotBalancesResult> {
  const items = await db
    .select({
      id: plaidItem.id,
      userId: plaidItem.userId,
      accessTokenEnc: plaidItem.accessTokenEnc,
    })
    .from(plaidItem)
    .where(ne(plaidItem.status, "revoked"));

  // Sequential: items are few, and Plaid rate-limits per client.
  let snapshotted = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await snapshotItem(item, asOfDate);
      snapshotted++;
    } catch (err) {
      failed++;
      console.error(
        `[plaid] balance snapshot failed for plaid_item ${item.id}:`,
        describePlaidError(err),
      );
    }
  }
  return { snapshotted, failed };
}
