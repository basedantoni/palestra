/**
 * Plaid access tokens only work in the environment that issued them (KOI-288).
 * Items linked under another `PLAID_ENV` are skipped, never sent to Plaid.
 */
import { env } from "@life-tracker/env/server";

export type PlaidEnv = "sandbox" | "production";

/** Why an item can't be used from this server, or null when its environment matches. */
export function foreignPlaidEnvError(itemEnv: PlaidEnv): string | null {
  if (itemEnv === env.PLAID_ENV) return null;
  return `Linked in ${itemEnv} — switch PLAID_ENV to manage`;
}
