import { db } from "@life-tracker/db";
import { whoopConnection } from "@life-tracker/db/schema/index";
import { env } from "@life-tracker/env/server";
import { eq } from "drizzle-orm";

import { encryptToken } from "./token-encryption";
import { triggerBackfill } from "./whoop-backfill";

const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API_BASE_V2 = "https://api.prod.whoop.com/developer/v2";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface WhoopUserProfile {
  user_id: number | string;
  [key: string]: unknown;
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

  // (Sync) Fetch whoopUserId from Whoop's profile endpoint
  let whoopUserId: string | null = null;
  try {
    const profileResponse = await fetch(
      `${WHOOP_API_BASE_V2}/user/profile/basic`,
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      },
    );
    if (profileResponse.ok) {
      const profile = (await profileResponse.json()) as WhoopUserProfile;
      whoopUserId = profile.user_id != null ? String(profile.user_id) : null;
    } else {
      console.warn("Whoop profile fetch failed:", profileResponse.status);
    }
  } catch (err) {
    console.warn("Whoop profile fetch error:", err);
  }

  let isFirstConnect = false;
  try {
    const rows = await db
      .insert(whoopConnection)
      .values({
        id: crypto.randomUUID(),
        userId,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt: expiresAt,
        isValid: true,
        whoopUserId,
      })
      .onConflictDoUpdate({
        target: whoopConnection.userId,
        set: {
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          tokenExpiresAt: expiresAt,
          isValid: true,
          connectedAt: new Date(),
          whoopUserId,
        },
      });

    // Detect first connect: upsert returned rows with lastImportedAt = null
    if (Array.isArray(rows) && rows.length > 0) {
      const savedRow = rows[0] as { lastImportedAt?: Date | null } | undefined;
      isFirstConnect =
        savedRow?.lastImportedAt === null ||
        savedRow?.lastImportedAt === undefined;
    }
  } catch (err) {
    console.error("Whoop connection save failed:", err);
    return { ok: false, error: "Failed to save Whoop connection" };
  }

  // (Async) Trigger 30-day backfill on first-ever connect only
  if (isFirstConnect) {
    setImmediate(() => {
      triggerBackfill(userId, 30);
    });
  }

  return { ok: true };
}

/**
 * Deletes the Whoop connection row for a user.
 */
export async function deleteWhoopConnection(userId: string): Promise<void> {
  await db.delete(whoopConnection).where(eq(whoopConnection.userId, userId));
}
