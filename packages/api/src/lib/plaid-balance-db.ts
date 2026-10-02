/**
 * Persist Plaid account balances + daily balance snapshots.
 *
 * Shared by the transaction sync (`plaid-sync-db.ts`) and the daily snapshot
 * job (`plaid-balance-snapshot.ts`, KOI-289) so both capture paths write
 * balances identically. Snapshots upsert on (account, day): a same-day re-run
 * updates the row rather than duplicating it.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@life-tracker/db";
import { balanceSnapshot, financialAccount } from "@life-tracker/db/schema/index";

import type { AccountBalanceMutations } from "./plaid-sync-transform";

/**
 * Write balance updates and snapshots for one user's accounts. Plaid accounts
 * missing from `accountIdByPlaid` (not linked locally) are skipped.
 */
export async function persistAccountBalances(
  userId: string,
  accountIdByPlaid: Map<string, string>,
  mutations: AccountBalanceMutations,
): Promise<void> {
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
}
