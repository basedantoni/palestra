/**
 * Plaid webhook verification (KOI-105).
 *
 * Plaid signs each webhook with a JWT in the `Plaid-Verification` header
 * (ES256). Verification:
 *  1. Read the JWT's `kid`; reject anything not ES256.
 *  2. Fetch that key's JWK via `/webhook_verification_key/get` (cached by kid).
 *  3. Verify the JWT signature and reject tokens older than 5 minutes (replay).
 *  4. Compare the JWT's `request_body_sha256` claim to the SHA-256 of the raw
 *     request body (timing-safe) so the payload can't be tampered with.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { type JWK, decodeProtectedHeader, importJWK, jwtVerify } from "jose";

import { getPlaidClient } from "./plaid-client";

const MAX_TOKEN_AGE_SECONDS = 5 * 60;
const keyCache = new Map<string, JWK>();

async function getVerificationKey(kid: string): Promise<JWK> {
  const cached = keyCache.get(kid);
  if (cached) return cached;
  const plaid = getPlaidClient();
  const res = await plaid.webhookVerificationKeyGet({ key_id: kid });
  const jwk = res.data.key as unknown as JWK;
  keyCache.set(kid, jwk);
  return jwk;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Returns true only when the JWT is a valid, fresh ES256 Plaid signature whose
 * body hash matches `rawBody`. Any failure (missing header, wrong alg, bad
 * signature, expired, hash mismatch, key fetch error) returns false.
 */
export async function verifyPlaidWebhook(
  rawBody: string,
  jwt: string | undefined,
): Promise<boolean> {
  if (!jwt) return false;
  try {
    const { alg, kid } = decodeProtectedHeader(jwt);
    if (alg !== "ES256" || !kid) return false;

    const jwk = await getVerificationKey(kid);
    const key = await importJWK(jwk, "ES256");
    const { payload } = await jwtVerify(jwt, key, {
      algorithms: ["ES256"],
      maxTokenAge: MAX_TOKEN_AGE_SECONDS,
    });

    const claimed = payload.request_body_sha256;
    if (typeof claimed !== "string") return false;
    return timingSafeEqualHex(claimed, sha256Hex(rawBody));
  } catch {
    return false;
  }
}
