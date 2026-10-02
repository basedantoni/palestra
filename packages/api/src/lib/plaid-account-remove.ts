/**
 * Remove a connected financial account.
 *
 * Plaid has no per-account unlink — access is granted per Item (institution).
 * So:
 *  - If the Item still has other accounts, only the local `financial_account`
 *    row is deleted. Sync skips Plaid accounts it has no row for, so the
 *    account stays gone until the user re-links the institution.
 *  - If this was the Item's last account, the Item is revoked at Plaid
 *    (`/item/remove`, stops billing + webhooks) and the `plaid_item` row is
 *    deleted. If Plaid refuses, the Item row (and its encrypted token) is kept
 *    so the revoke can be retried; only the account row is deleted.
 *
 * Transactions, balance snapshots, and goal links cascade via FKs.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@life-tracker/db";
import { financialAccount, plaidItem } from "@life-tracker/db/schema/index";

import { decryptToken } from "./token-encryption";
import { describePlaidError, getPlaidClient, getTokenEncryptionKey } from "./plaid-client";

export type RemoveAccountResult =
  | { removed: false }
  | { removed: true; itemRemoved: boolean };

/** Plaid already considers the Item gone — safe to drop our row. */
export function isPlaidItemGoneError(err: unknown): boolean {
  const code = (err as { response?: { data?: { error_code?: string } } })?.response?.data
    ?.error_code;
  return code === "ITEM_NOT_FOUND";
}

export async function removeFinancialAccount(
  userId: string,
  accountId: string,
): Promise<RemoveAccountResult> {
  const [account] = await db
    .select({ id: financialAccount.id, plaidItemId: financialAccount.plaidItemId })
    .from(financialAccount)
    .where(and(eq(financialAccount.id, accountId), eq(financialAccount.userId, userId)))
    .limit(1);
  if (!account) return { removed: false };

  const siblings = await db
    .select({ id: financialAccount.id })
    .from(financialAccount)
    .where(eq(financialAccount.plaidItemId, account.plaidItemId));

  if (siblings.length <= 1 && (await revokePlaidItem(account.plaidItemId))) {
    // Cascades to the account row and everything under it.
    await db.delete(plaidItem).where(eq(plaidItem.id, account.plaidItemId));
    return { removed: true, itemRemoved: true };
  }

  await db.delete(financialAccount).where(eq(financialAccount.id, account.id));
  return { removed: true, itemRemoved: false };
}

/** Revoke the Item at Plaid. Returns true if our row can be safely deleted. */
async function revokePlaidItem(plaidItemId: string): Promise<boolean> {
  const [item] = await db
    .select({ accessTokenEnc: plaidItem.accessTokenEnc })
    .from(plaidItem)
    .where(eq(plaidItem.id, plaidItemId))
    .limit(1);
  if (!item) return false;

  try {
    const accessToken = decryptToken(item.accessTokenEnc, getTokenEncryptionKey());
    await getPlaidClient().itemRemove({ access_token: accessToken });
    return true;
  } catch (err) {
    if (isPlaidItemGoneError(err)) return true;
    console.error(`[plaid] itemRemove failed for plaid_item ${plaidItemId}:`, describePlaidError(err));
    return false;
  }
}
