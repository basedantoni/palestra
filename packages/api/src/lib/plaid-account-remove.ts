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
 * `removePlaidItem` is the escape hatch for a bank Plaid won't revoke (e.g. a
 * token from another Plaid environment): with `force`, the local row and its
 * token are dropped anyway and the user cleans up in the Plaid dashboard.
 *
 * Transactions, balance snapshots, and goal links cascade via FKs.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@life-tracker/db";
import { financialAccount, plaidItem } from "@life-tracker/db/schema/index";

import { decryptToken } from "./token-encryption";
import { describePlaidError, getPlaidClient, getTokenEncryptionKey } from "./plaid-client";
import { foreignPlaidEnvError } from "./plaid-env";

export type RemoveAccountResult =
  | { removed: false }
  | { removed: true; itemRemoved: boolean };

export type RemoveItemResult =
  | { removed: false; notFound: true }
  | { removed: false; notFound: false; error: string }
  | { removed: true; revoked: boolean };

type RevokeResult = { ok: true } | { ok: false; error: string };

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

  if (siblings.length <= 1 && (await revokePlaidItem(account.plaidItemId)).ok) {
    // Cascades to the account row and everything under it.
    await db.delete(plaidItem).where(eq(plaidItem.id, account.plaidItemId));
    return { removed: true, itemRemoved: true };
  }

  await db.delete(financialAccount).where(eq(financialAccount.id, account.id));
  return { removed: true, itemRemoved: false };
}

/**
 * Remove a whole bank (Plaid Item) and everything under it. Revokes at Plaid
 * first; when that fails the row is kept unless `force`, in which case it is
 * deleted anyway and the Item may still exist (and bill) at Plaid.
 */
export async function removePlaidItem(
  userId: string,
  plaidItemId: string,
  force: boolean,
): Promise<RemoveItemResult> {
  const [item] = await db
    .select({ id: plaidItem.id })
    .from(plaidItem)
    .where(and(eq(plaidItem.id, plaidItemId), eq(plaidItem.userId, userId)))
    .limit(1);
  if (!item) return { removed: false, notFound: true };

  const revoke = await revokePlaidItem(item.id);
  if (!revoke.ok && !force) return { removed: false, notFound: false, error: revoke.error };

  await db.delete(plaidItem).where(eq(plaidItem.id, item.id));
  return { removed: true, revoked: revoke.ok };
}

/** Revoke the Item at Plaid. `ok` means our row can be safely deleted. */
async function revokePlaidItem(plaidItemId: string): Promise<RevokeResult> {
  const [item] = await db
    .select({ accessTokenEnc: plaidItem.accessTokenEnc, plaidEnv: plaidItem.plaidEnv })
    .from(plaidItem)
    .where(eq(plaidItem.id, plaidItemId))
    .limit(1);
  if (!item) return { ok: false, error: "Plaid item not found" };

  // A foreign-environment token can't be revoked from here; don't send it to Plaid.
  const foreignEnv = foreignPlaidEnvError(item.plaidEnv);
  if (foreignEnv) return { ok: false, error: foreignEnv };

  try {
    const accessToken = decryptToken(item.accessTokenEnc, getTokenEncryptionKey());
    await getPlaidClient().itemRemove({ access_token: accessToken });
    return { ok: true };
  } catch (err) {
    if (isPlaidItemGoneError(err)) return { ok: true };
    const error = describePlaidError(err);
    console.error(`[plaid] itemRemove failed for plaid_item ${plaidItemId}:`, error);
    return { ok: false, error };
  }
}
