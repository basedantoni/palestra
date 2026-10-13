/**
 * Persist account balances + daily balance snapshots.
 *
 * Shared by the Plaid transaction sync (`plaid-sync-db.ts`), the daily Plaid
 * snapshot job (`plaid-balance-snapshot.ts`, KOI-289) and the SnapTrade
 * snapshot (`snaptrade-snapshot.ts`, KOI-318) so every capture path writes
 * balances identically. Snapshots upsert on (account, day): a same-day re-run
 * updates the row rather than duplicating it.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@life-tracker/db";
import { balanceSnapshot, financialAccount } from "@life-tracker/db/schema/index";

import type { AccountBalanceMutations } from "./plaid-sync-transform";

export interface AccountBalanceWrite {
  /** Palestra `financial_account.id`. */
  accountId: string;
  current: number | null;
  available: number | null;
  isoCurrencyCode: string | null;
}

export interface BalanceSnapshotWrite {
  /** Palestra `financial_account.id`. */
  accountId: string;
  asOfDate: string;
  balance: number;
}

/**
 * Write balance updates and (account, day) snapshots, keyed by Palestra account
 * id. The one write path for every capture source (Plaid, SnapTrade).
 */
export async function writeAccountBalances(
  userId: string,
  balances: AccountBalanceWrite[],
  snapshots: BalanceSnapshotWrite[],
): Promise<void> {
  for (const bal of balances) {
    await db
      .update(financialAccount)
      .set({
        currentBalance: bal.current,
        availableBalance: bal.available,
        isoCurrencyCode: bal.isoCurrencyCode,
      })
      .where(eq(financialAccount.id, bal.accountId));
  }
  for (const snap of snapshots) {
    await db
      .insert(balanceSnapshot)
      .values({
        id: randomUUID(),
        userId,
        accountId: snap.accountId,
        asOfDate: snap.asOfDate,
        balance: snap.balance,
      })
      .onConflictDoUpdate({
        target: [balanceSnapshot.accountId, balanceSnapshot.asOfDate],
        set: { balance: snap.balance },
      });
  }
}

/**
 * Plaid balances, keyed by Plaid account id, through `writeAccountBalances`.
 * Plaid accounts missing from `accountIdByPlaid` (not linked locally) are skipped.
 */
export async function persistAccountBalances(
  userId: string,
  accountIdByPlaid: Map<string, string>,
  mutations: AccountBalanceMutations,
): Promise<void> {
  const balances = mutations.accountBalances.flatMap(({ plaidAccountId, ...bal }) => {
    const accountId = accountIdByPlaid.get(plaidAccountId);
    return accountId ? [{ accountId, ...bal }] : [];
  });
  const snapshots = mutations.snapshots.flatMap(({ plaidAccountId, ...snap }) => {
    const accountId = accountIdByPlaid.get(plaidAccountId);
    return accountId ? [{ accountId, ...snap }] : [];
  });
  await writeAccountBalances(userId, balances, snapshots);
}
