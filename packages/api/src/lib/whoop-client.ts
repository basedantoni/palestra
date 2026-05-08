import { eq } from "drizzle-orm";

import { db } from "@src/db";
import { exercise, whoopConnection } from "@src/db/schema/index";
import { env } from "@src/env/server";
import { whoopSportToCardioSubtype } from "@src/shared";

import { decryptToken, encryptToken } from "./token-encryption";

export const WHOOP_API_BASE = "https://api.prod.whoop.com/developer/v2";

/**
 * Resolves the canonical library exercise for a Whoop sport.
 * Returns { id, name } so callers can set both exerciseId and exerciseName on the log.
 *
 * For running: picks "Short Run" (<8km) or "Long Run" (≥8km) based on distanceMeter.
 * For other cardio subtypes: returns the first matching exercise by cardioSubtype.
 * Returns null if no matching exercise found.
 */
export async function resolveWhoopExerciseId(
  sportId: number,
  sportName?: string,
  distanceMeter?: number | null,
): Promise<{ id: string; name: string } | null> {
  const subtype = whoopSportToCardioSubtype(sportId, sportName);
  if (!subtype) return null;

  let targetName: string | null = null;
  if (subtype === "running") {
    targetName = distanceMeter != null && distanceMeter >= 8000 ? "Long Run" : "Short Run";
  }

  const [row] = await db
    .select({ id: exercise.id, name: exercise.name })
    .from(exercise)
    .where(
      targetName
        ? eq(exercise.name, targetName)
        : eq(exercise.cardioSubtype, subtype as "running" | "cycling" | "swimming" | "rowing" | "other"),
    )
    .limit(1);

  return row ? { id: row.id, name: row.name } : null;
}

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
