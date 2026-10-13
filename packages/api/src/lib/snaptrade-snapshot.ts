/**
 * Daily SnapTrade balance snapshot (KOI-318, ADR 0003).
 *
 * Fidelity (NetBenefits 401k, fidelity.com accounts) is connected in
 * SnapTrade's own dashboard under a Personal API key, which belongs to one
 * person: `SNAPTRADE_OWNER_EMAIL`. Once a day, next to the Plaid capture, each
 * SnapTrade account becomes (or updates) a linked investment account with
 * today's Balance Snapshot, through the same write path as Plaid.
 *
 * Read-only toward SnapTrade: `listUserAccounts` is the only call. Raw
 * brokerage responses are never stored or logged. Accounts SnapTrade stops
 * returning are left alone: their history stays, they get no new snapshots.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import type { Account } from "snaptrade-typescript-sdk";

import { db } from "@life-tracker/db";
import { financialAccount, user } from "@life-tracker/db/schema/index";

import { writeAccountBalances } from "./plaid-balance-db";
import { describeSnaptradeError } from "./snaptrade-client";

/** The slice of the SnapTrade client this job uses. Tests pass a fake. */
export interface SnaptradeAccountsClient {
  accountInformation: { listUserAccounts(): Promise<{ data: Account[] }> };
}

/** What Palestra keeps of a SnapTrade account. */
export interface SnaptradeAccountView {
  snaptradeAccountId: string;
  name: string | null;
  mask: string | null;
  institutionName: string | null;
  totalValue: number | null;
  currency: string | null;
  subtype: string | null;
}

export interface SnaptradeSnapshotResult {
  configured: boolean;
  synced: number;
  failed: number;
  errors: string[];
}

/** SnapTrade account → the fields Palestra stores. Pure. */
export function normalizeSnaptradeAccount(account: Account): SnaptradeAccountView {
  const digits = (account.number ?? "").replace(/[^0-9A-Za-z]/g, "");
  const total = account.balance?.total;
  return {
    snaptradeAccountId: account.id,
    name: account.name ?? account.institution_name ?? null,
    mask: digits ? digits.slice(-4) : null,
    institutionName: account.institution_name ?? null,
    totalValue: typeof total?.amount === "number" ? total.amount : null,
    currency: total?.currency ?? null,
    subtype: account.raw_type ?? null,
  };
}

async function snapshotAccount(
  userId: string,
  view: SnaptradeAccountView,
  asOfDate: string,
): Promise<void> {
  const { totalValue } = view;
  // Missing, not zero: a zero snapshot would show as a Net Worth crash.
  if (totalValue === null) throw new Error("SnapTrade returned no total value");

  const fields = {
    name: view.name!, // a null name fails the NOT NULL column, failing just this account
    mask: view.mask,
    institutionName: view.institutionName,
    subtype: view.subtype,
  };
  const [row] = await db
    .insert(financialAccount)
    .values({
      id: randomUUID(),
      userId,
      source: "snaptrade",
      snaptradeAccountId: view.snaptradeAccountId,
      type: "investment",
      ...fields,
    })
    .onConflictDoUpdate({ target: financialAccount.snaptradeAccountId, set: fields })
    .returning({ id: financialAccount.id });

  await writeAccountBalances(
    userId,
    [{ accountId: row!.id, current: totalValue, available: null, isoCurrencyCode: view.currency }],
    [{ accountId: row!.id, asOfDate, balance: totalValue }],
  );
}

/**
 * Snapshot every account under the Personal key for `asOfDate`. A null client
 * or owner email means SnapTrade isn't configured: a reported no-op. An owner
 * email with no Palestra user throws. One account failing never sinks the rest.
 */
export async function snapshotSnaptradeAccounts({
  client,
  ownerEmail,
  asOfDate,
}: {
  client: SnaptradeAccountsClient | null;
  ownerEmail: string | undefined;
  asOfDate: string;
}): Promise<SnaptradeSnapshotResult> {
  if (!client || !ownerEmail) return { configured: false, synced: 0, failed: 0, errors: [] };

  const [owner] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, ownerEmail))
    .limit(1);
  if (!owner) throw new Error("SNAPTRADE_OWNER_EMAIL matches no Palestra user");

  const { data } = await client.accountInformation.listUserAccounts();
  const views = data.map(normalizeSnaptradeAccount);
  const settled = await Promise.allSettled(
    views.map((view) => snapshotAccount(owner.id, view, asOfDate)),
  );

  const errors = settled.flatMap((s, i) =>
    s.status === "rejected"
      ? [`account ${views[i]!.snaptradeAccountId}: ${describeSnaptradeError(s.reason)}`]
      : [],
  );
  for (const e of errors) console.error(`[snaptrade] balance snapshot failed for ${e}`);
  return { configured: true, synced: views.length - errors.length, failed: errors.length, errors };
}
