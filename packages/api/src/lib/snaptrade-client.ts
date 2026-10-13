/**
 * The one place SnapTrade credentials are read (KOI-318). Server-only.
 *
 * Personal API key per SnapTrade's "Build with AI" guide: account calls take no
 * userId/userSecret, there's no registerSnapTradeUser, and the SDK signs
 * requests. Palestra only reads account balances: never call a trading/order
 * endpoint through this client.
 */
import { Snaptrade, SnaptradeAuth, SnaptradeError } from "snaptrade-typescript-sdk";

import { env } from "@life-tracker/env/server";

let cached: Snaptrade<ReturnType<typeof SnaptradeAuth.personalApiKey>> | null = null;

/** A configured SnapTrade client, or null when any SNAPTRADE_* var is unset. */
export function getSnaptradeClient() {
  if (!env.SNAPTRADE_CLIENT_ID || !env.SNAPTRADE_CONSUMER_KEY || !env.SNAPTRADE_OWNER_EMAIL) {
    return null;
  }
  cached ??= new Snaptrade({
    auth: SnaptradeAuth.personalApiKey({
      clientId: env.SNAPTRADE_CLIENT_ID,
      consumerKey: env.SNAPTRADE_CONSUMER_KEY,
    }),
  });
  return cached;
}

/**
 * A short, log-safe reason for a failed call. SnaptradeError's message carries
 * the response headers and `responseBody` the brokerage payload: neither is
 * logged. A DB failure reports its Postgres cause, not the query and params.
 */
export function describeSnaptradeError(err: unknown): string {
  if (err instanceof SnaptradeError) {
    return `SnapTrade ${err.status ?? err.code ?? "error"} ${err.statusText ?? ""}`.trim();
  }
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.split("\n")[0]!.slice(0, 200);
}
