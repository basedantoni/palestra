/**
 * Plaid access tokens only work in the environment that issued them (KOI-288).
 * Items linked under another `PLAID_ENV` are skipped, never sent to Plaid.
 */
import type { plaidEnvEnum } from "@life-tracker/db/schema/enums";
import { env } from "@life-tracker/env/server";

export type PlaidEnv = (typeof plaidEnvEnum.enumValues)[number];

export function isForeignPlaidEnv(itemEnv: PlaidEnv): boolean {
  return itemEnv !== env.PLAID_ENV;
}

/** Why an item can't be used from this server, or null when its environment matches. */
export function foreignPlaidEnvError(itemEnv: PlaidEnv): string | null {
  return isForeignPlaidEnv(itemEnv) ? `Linked in ${itemEnv} — switch PLAID_ENV to manage` : null;
}

/** The environment this server is not running: for fixtures and tests of the foreign case. */
export function otherPlaidEnv(): PlaidEnv {
  return env.PLAID_ENV === "production" ? "sandbox" : "production";
}
