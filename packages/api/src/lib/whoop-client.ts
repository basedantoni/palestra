import { eq } from "drizzle-orm";

import { db } from "@src/db";
import { whoopConnection } from "@src/db/schema/index";
import { env } from "@src/env/server";

import { decryptToken, encryptToken } from "./token-encryption";

export const WHOOP_API_BASE = "https://api.prod.whoop.com/developer/v2";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

/**
 * Refreshes the Whoop access token for a user.
 * Updates the DB row on success, sets isValid=false on failure.
 * Returns the new access token, or throws if refresh fails.
 */
export async function refreshWhoopToken(userId: string, currentRefreshToken: string): Promise<string> {
  const clientId = env.WHOOP_CLIENT_ID;
  const clientSecret = env.WHOOP_CLIENT_SECRET;
  const encryptionKey = env.TOKEN_ENCRYPTION_KEY;

  if (!clientId || !clientSecret || !encryptionKey) {
    throw new Error("Whoop integration is not configured");
  }

  const response = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: currentRefreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    // Mark connection as invalid
    await db
      .update(whoopConnection)
      .set({ isValid: false })
      .where(eq(whoopConnection.userId, userId));
    throw new Error(`Whoop token refresh failed: ${response.status}`);
  }

  const tokens = (await response.json()) as TokenResponse;
  const encryptedAccess = encryptToken(tokens.access_token, encryptionKey);
  const encryptedRefresh = encryptToken(tokens.refresh_token, encryptionKey);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await db
    .update(whoopConnection)
    .set({
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt: expiresAt,
      isValid: true,
    })
    .where(eq(whoopConnection.userId, userId));

  return tokens.access_token;
}

/**
 * Returns a valid (possibly refreshed) Whoop access token for the given user.
 * Throws if no connection exists, connection is invalid, or refresh fails.
 */
export async function getValidWhoopAccessToken(userId: string): Promise<string> {
  const encryptionKey = env.TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("Whoop integration is not configured");
  }

  const [connection] = await db
    .select()
    .from(whoopConnection)
    .where(eq(whoopConnection.userId, userId))
    .limit(1);

  if (!connection) {
    throw new Error("No Whoop connection found");
  }

  if (!connection.isValid) {
    throw new Error("Whoop connection is invalid — please reconnect");
  }

  const decryptedRefresh = decryptToken(connection.refreshToken, encryptionKey);

  // Refresh if the token expires within the next 5 minutes
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (connection.tokenExpiresAt <= fiveMinutesFromNow) {
    return refreshWhoopToken(userId, decryptedRefresh);
  }

  return decryptToken(connection.accessToken, encryptionKey);
}
