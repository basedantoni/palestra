import { createHash, randomBytes } from "node:crypto";

import { Hono } from "hono";

import { auth } from "@src/auth";
import { env } from "@src/env/server";
import { handleWhoopCallback } from "@src/api/lib/whoop-oauth";
import { getValidWhoopAccessToken, WHOOP_API_BASE } from "@src/api/lib/whoop-client";

const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";

function getSettingsUrl(baseUrl: string, params?: Record<string, string>): string {
  const url = new URL("/settings", baseUrl);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/** Generate a PKCE code verifier (43–128 chars, URL-safe base64). */
function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** Derive PKCE code challenge (S256) from verifier. */
function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export const whoopOAuthApp = new Hono();

/**
 * GET /api/whoop/connect
 * Initiates the Whoop OAuth 2.0 PKCE flow.
 * Requires an active session — redirects to Whoop authorization page.
 */
whoopOAuthApp.get("/connect", async (c) => {
  const corsOrigin = env.CORS_ORIGIN;
  const clientId = env.WHOOP_CLIENT_ID;
  const redirectUri = env.WHOOP_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return c.redirect(
      getSettingsUrl(corsOrigin, { whoop_error: "Whoop integration is not configured" }),
    );
  }

  // Verify session
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.redirect(
      getSettingsUrl(corsOrigin, { whoop_error: "Authentication required" }),
    );
  }

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);

  // Encode verifier in state so the callback can retrieve it without server-side storage.
  // State format: base64url(userId + ":" + verifier)
  const statePayload = Buffer.from(`${session.user.id}:${verifier}`).toString("base64url");

  const authUrl = new URL(WHOOP_AUTH_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "read:workout read:recovery read:sleep read:profile offline");
  authUrl.searchParams.set("state", statePayload);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  return c.redirect(authUrl.toString());
});

/**
 * DEV ONLY — GET /api/whoop/raw/:path
 * Proxies any Whoop API v2 request using the authenticated user's stored token.
 * Example: GET /api/whoop/raw/activity/workout?limit=5
 * Remove before deploying to production.
 */
if (process.env.NODE_ENV !== "production") {
  whoopOAuthApp.get("/raw/*", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    // Strip everything up to and including /raw/ to get the Whoop API path
    const rawPath = c.req.path.replace(/^.*\/raw\//, "");
    const queryString = new URL(c.req.url).search;
    const whoopUrl = `${WHOOP_API_BASE}/${rawPath}${queryString}`;

    const accessToken = await getValidWhoopAccessToken(session.user.id);
    const response = await fetch(whoopUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const body = await response.text();
    return c.text(body, response.status as any, {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    });
  });
}

/**
 * GET /api/whoop/callback
 * Handles the OAuth callback from Whoop.
 * Exchanges the code for tokens, encrypts them, and saves to DB.
 */
whoopOAuthApp.get("/callback", async (c) => {
  const corsOrigin = env.CORS_ORIGIN;

  const redirect = (params: Record<string, string>) =>
    c.redirect(getSettingsUrl(corsOrigin, params));

  // Check for error from Whoop (user cancelled or denied)
  const error = c.req.query("error");
  if (error) {
    const errorDescription = c.req.query("error_description") ?? "OAuth authorization failed";
    return redirect({ whoop_error: errorDescription });
  }

  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return redirect({ whoop_error: "Missing code or state in callback" });
  }

  // Decode state to recover userId and PKCE verifier
  let userId: string;
  let verifier: string;
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const colonIdx = decoded.indexOf(":");
    if (colonIdx === -1) throw new Error("Invalid state format");
    userId = decoded.slice(0, colonIdx);
    verifier = decoded.slice(colonIdx + 1);
    if (!userId || !verifier) throw new Error("Empty userId or verifier");
  } catch {
    return redirect({ whoop_error: "Invalid OAuth state parameter" });
  }

  const result = await handleWhoopCallback(userId, code, verifier);
  if (!result.ok) {
    return redirect({ whoop_error: result.error });
  }

  return redirect({ whoop_connected: "true" });
});
