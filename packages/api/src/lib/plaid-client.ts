/**
 * Lazily-built Plaid API client + parsed config from env.
 *
 * Fails loud: if `PLAID_CLIENT_ID` / `PLAID_SECRET` are missing (e.g. a
 * mistyped env var), client init throws a clear error rather than silently
 * issuing unauthenticated requests.
 */
import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";

import { env } from "@life-tracker/env/server";

let cached: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi {
  if (cached) return cached;

  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
    throw new Error(
      "Plaid is not configured: set PLAID_CLIENT_ID and PLAID_SECRET in the server env.",
    );
  }

  const configuration = new Configuration({
    basePath: PlaidEnvironments[env.PLAID_ENV],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": env.PLAID_CLIENT_ID,
        "PLAID-SECRET": env.PLAID_SECRET,
      },
    },
  });

  cached = new PlaidApi(configuration);
  return cached;
}

/** Encryption key for Plaid access tokens at rest (reused from Whoop). */
export function getTokenEncryptionKey(): string {
  if (!env.TOKEN_ENCRYPTION_KEY) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set; cannot encrypt Plaid access tokens.",
    );
  }
  return env.TOKEN_ENCRYPTION_KEY;
}

export const PLAID_PRODUCTS: Products[] = env.PLAID_PRODUCTS.split(",")
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => p as Products);

export const PLAID_COUNTRY_CODES: CountryCode[] = env.PLAID_COUNTRY_CODES.split(",")
  .map((c) => c.trim())
  .filter(Boolean)
  .map((c) => c as CountryCode);
