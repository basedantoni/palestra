/**
 * Decrypted access to a user's own Plaid item. The token is returned only to
 * server code that calls Plaid with it — never send it to the client or log it.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@life-tracker/db";
import { plaidItem } from "@life-tracker/db/schema/index";

import { decryptToken } from "./token-encryption";
import { getTokenEncryptionKey } from "./plaid-client";

/**
 * Revoked access (the user withdrew consent at their bank) can't be restored
 * with Link update mode — Plaid requires linking the bank again as a new Item.
 */
export function canRepairInUpdateMode(status: string): boolean {
  return status !== "active" && status !== "revoked";
}

/** The item's access token + status, or null if the user doesn't own `plaidItemId`. */
export async function getOwnedPlaidItem(
  userId: string,
  plaidItemId: string,
): Promise<{ accessToken: string; status: string } | null> {
  const [item] = await db
    .select({ accessTokenEnc: plaidItem.accessTokenEnc, status: plaidItem.status })
    .from(plaidItem)
    .where(and(eq(plaidItem.id, plaidItemId), eq(plaidItem.userId, userId)))
    .limit(1);
  if (!item) return null;
  return {
    accessToken: decryptToken(item.accessTokenEnc, getTokenEncryptionKey()),
    status: item.status,
  };
}
