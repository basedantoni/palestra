import { db } from "@src/db";
import { whoopConnection } from "@src/db/schema/index";
import { env } from "@src/env/server";
import { eq } from "drizzle-orm";

import { encryptToken } from "./token-encryption";

const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

/**
 * Exchanges an OAuth authorization code for tokens and saves the
 * encrypted connection row to the DB. Returns success/error.
 */
export async function handleWhoopCallback(
  userId: string,
  code: string,
  verifier: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clientId = env.WHOOP_CLIENT_ID;
  const clientSecret = env.WHOOP_CLIENT_SECRET;
  const redirectUri = env.WHOOP_REDIRECT_URI;
  const encryptionKey = env.TOKEN_ENCRYPTION_KEY;

  if (!clientId || !clientSecret || !redirectUri || !encryptionKey) {
    return { ok: false, error: "Whoop integration is not configured" };
  }

  let tokens: TokenResponse;
  try {
    const tokenResponse = await fetch(WHOOP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: verifier,
      }),
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      console.error("Whoop token exchange failed:", tokenResponse.status, body);
      return { ok: false, error: "Failed to exchange authorization code" };
    }

    tokens = (await tokenResponse.json()) as TokenResponse;
  } catch (err) {
    console.error("Whoop token exchange error:", err);
    return { ok: false, error: "Token exchange request failed" };
  }

  const encryptedAccess = encryptToken(tokens.access_token, encryptionKey);
  const encryptedRefresh = encryptToken(tokens.refresh_token, encryptionKey);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  try {
    await db
      .insert(whoopConnection)
      .values({
        id: crypto.randomUUID(),
        userId,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt: expiresAt,
        isValid: true,
      })
      .onConflictDoUpdate({
        target: whoopConnection.userId,
        set: {
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          tokenExpiresAt: expiresAt,
          isValid: true,
          connectedAt: new Date(),
        },
      });
  } catch (err) {
    console.error("Whoop connection save failed:", err);
    return { ok: false, error: "Failed to save Whoop connection" };
  }

  return { ok: true };
}

/**
 * Deletes the Whoop connection row for a user.
 */
export async function deleteWhoopConnection(userId: string): Promise<void> {
  await db
    .delete(whoopConnection)
    .where(eq(whoopConnection.userId, userId));
}
