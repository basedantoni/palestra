/**
 * On-demand Plaid sync for a user's linked banks (KOI-274) — the manual
 * counterpart to the webhook-driven drain.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@life-tracker/db";
import { plaidItem } from "@life-tracker/db/schema/index";

import { describePlaidError } from "./plaid-client";
import { syncPlaidItem } from "./plaid-sync-db";

export type PlaidItemSyncResult = { plaidItemId: string; institutionName: string | null } & (
  | { ok: true; added: number; modified: number; removed: number }
  | { ok: false; error: string }
);

/**
 * Sync every Plaid item the user owns, or just `plaidItemId`. Returns null when
 * a specific item was requested but the user doesn't own it.
 *
 * One item failing doesn't stop the rest; its error is reported in its result.
 * Revoked items are skipped — Plaid would reject them until the user reconnects.
 */
export async function syncPlaidItemsForUser(
  userId: string,
  plaidItemId?: string,
): Promise<PlaidItemSyncResult[] | null> {
  const owned = eq(plaidItem.userId, userId);
  const items = await db
    .select({
      id: plaidItem.id,
      institutionName: plaidItem.institutionName,
      status: plaidItem.status,
    })
    .from(plaidItem)
    .where(plaidItemId ? and(owned, eq(plaidItem.id, plaidItemId)) : owned);
  if (plaidItemId && items.length === 0) return null;

  // Sequential: items are few, and Plaid rate-limits per client.
  const results: PlaidItemSyncResult[] = [];
  for (const item of items) {
    const base = { plaidItemId: item.id, institutionName: item.institutionName };
    if (item.status === "revoked") {
      results.push({ ...base, ok: false, error: "Access revoked — reconnect this bank" });
      continue;
    }
    try {
      results.push({ ...base, ok: true, ...(await syncPlaidItem(item.id)) });
    } catch (err) {
      const error = describePlaidError(err);
      console.error(`[plaid] sync failed for plaid_item ${item.id}:`, error);
      results.push({ ...base, ok: false, error });
    }
  }
  return results;
}
