/**
 * SnapTrade daily balance snapshot (KOI-318) against a real Postgres (PGlite):
 * the financial_account CHECK, the snaptrade_account_id unique index and the
 * (account, day) snapshot upsert run for real. SnapTrade itself is a fake that
 * records every method called on it.
 *
 * - first run creates investment accounts (source snaptrade) + a snapshot each
 * - same-day re-run updates in place; next-day run adds a second snapshot
 * - one account failing leaves the rest persisted and is reported
 * - no total value → failed, no snapshot (never zero)
 * - non-USD currency stored as reported
 * - unknown owner throws; unconfigured is a reported no-op
 * - Plaid accounts and their snapshots are untouched
 * - only listUserAccounts is ever called (no order/trade endpoints)
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import type { Account } from "snaptrade-typescript-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import { balanceSnapshot, financialAccount, plaidItem } from "@life-tracker/db/schema/index";

import { snapshotSnaptradeAccounts } from "../lib/snaptrade-snapshot";
import { seedFinanceUser, truncateAll } from "./helpers/pglite";

const OWNER = "user-snaptrade-owner";
const OWNER_EMAIL = `${OWNER}@test.internal`;
const DAY_1 = "2026-10-12";
const DAY_2 = "2026-10-13";

/** The fields Palestra reads from a SnapTrade account; the rest are irrelevant here. */
function snapAccount(over: {
  id: string;
  amount?: number | null;
  currency?: string;
  name?: string | null;
  institution?: string | null;
}): Account {
  const amount = over.amount === undefined ? 1000 : over.amount;
  return {
    id: over.id,
    brokerage_authorization: "auth-1",
    name: over.name === undefined ? `Account ${over.id}` : over.name,
    number: "Z12345678",
    institution_name: over.institution === undefined ? "Fidelity" : over.institution,
    created_date: "2026-01-01T00:00:00Z",
    sync_status: {},
    balance: { total: amount === null ? null : { amount, currency: over.currency ?? "USD" } },
    raw_type: "401k",
  } as Account;
}

/** A SnapTrade client double: serves `accounts`, records every method path called on it. */
function fakeClient(accounts: Account[]) {
  const calls: string[] = [];
  const api = (group: string) =>
    new Proxy(
      {},
      {
        get: (_, method: string) => async () => {
          calls.push(`${group}.${method}`);
          if (group === "accountInformation" && method === "listUserAccounts") {
            return { data: accounts };
          }
          throw new Error(`unexpected SnapTrade call ${group}.${method}`);
        },
      },
    );
  const client = new Proxy({}, { get: (_, group: string) => api(group) }) as Parameters<
    typeof snapshotSnaptradeAccounts
  >[0]["client"];
  return { client, calls };
}

const run = (accounts: Account[], asOfDate = DAY_1) =>
  snapshotSnaptradeAccounts({ client: fakeClient(accounts).client, ownerEmail: OWNER_EMAIL, asOfDate });

const snaptradeRows = () =>
  db.select().from(financialAccount).where(eq(financialAccount.source, "snaptrade"));

const snapshotsOf = (accountId: string) =>
  db.select().from(balanceSnapshot).where(eq(balanceSnapshot.accountId, accountId));

beforeEach(async () => {
  await truncateAll(db);
  await seedFinanceUser(db, OWNER);
});

describe("snapshotSnaptradeAccounts", () => {
  it("creates an investment account with today's snapshot for each SnapTrade account", async () => {
    const result = await run([
      snapAccount({ id: "st-401k", amount: 152340.12, name: "NetBenefits 401k" }),
      snapAccount({ id: "st-ira", amount: 9800 }),
    ]);

    expect(result).toEqual({ configured: true, synced: 2, failed: 0, errors: [] });
    const rows = await snaptradeRows();
    expect(rows).toHaveLength(2);
    const k401 = rows.find((r) => r.snaptradeAccountId === "st-401k")!;
    expect(k401).toMatchObject({
      userId: OWNER,
      source: "snaptrade",
      type: "investment",
      subtype: "401k",
      name: "NetBenefits 401k",
      mask: "5678",
      institutionName: "Fidelity",
      currentBalance: 152340.12,
      isoCurrencyCode: "USD",
      plaidItemId: null,
      plaidAccountId: null,
    });
    expect(await snapshotsOf(k401.id)).toMatchObject([
      { userId: OWNER, asOfDate: DAY_1, balance: 152340.12 },
    ]);
  });

  it("updates the same row and day's snapshot on a same-day re-run", async () => {
    await run([snapAccount({ id: "st-401k", amount: 100 })]);
    await run([snapAccount({ id: "st-401k", amount: 250 })]);

    const rows = await snaptradeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.currentBalance).toBe(250);
    expect(await snapshotsOf(rows[0]!.id)).toMatchObject([{ asOfDate: DAY_1, balance: 250 }]);
  });

  it("adds a second snapshot to the same account row the next day", async () => {
    await run([snapAccount({ id: "st-401k", amount: 100 })], DAY_1);
    await run([snapAccount({ id: "st-401k", amount: 110 })], DAY_2);

    const rows = await snaptradeRows();
    expect(rows).toHaveLength(1);
    const snaps = await snapshotsOf(rows[0]!.id);
    expect(snaps.map((s) => [s.asOfDate, s.balance]).toSorted()).toEqual([
      [DAY_1, 100],
      [DAY_2, 110],
    ]);
  });

  it("keeps the other accounts when one fails to persist, and reports it", async () => {
    const result = await run([
      snapAccount({ id: "st-ok", amount: 500 }),
      // No name from anywhere: the NOT NULL name column rejects the row.
      snapAccount({ id: "st-bad", amount: 700, name: null, institution: null }),
    ]);

    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([expect.stringContaining("st-bad")]);
    const rows = await snaptradeRows();
    expect(rows.map((r) => r.snaptradeAccountId)).toEqual(["st-ok"]);
    expect(await snapshotsOf(rows[0]!.id)).toHaveLength(1);
  });

  it("fails an account with no total value instead of snapshotting zero", async () => {
    const result = await run([
      snapAccount({ id: "st-ok", amount: 500 }),
      snapAccount({ id: "st-empty", amount: null }),
    ]);

    expect(result).toMatchObject({ synced: 1, failed: 1 });
    expect(result.errors).toEqual([expect.stringMatching(/st-empty.*total value/)]);
    const rows = await snaptradeRows();
    expect(rows.map((r) => r.snaptradeAccountId)).toEqual(["st-ok"]);
    const all = await db.select().from(balanceSnapshot);
    expect(all.some((s) => s.balance === 0)).toBe(false);
  });

  it("stores a non-USD currency as reported", async () => {
    await run([snapAccount({ id: "st-cad", amount: 4200, currency: "CAD" })]);

    const [row] = await snaptradeRows();
    expect(row!.isoCurrencyCode).toBe("CAD");
  });

  it("throws when the owner email has no Palestra user", async () => {
    await expect(
      snapshotSnaptradeAccounts({
        client: fakeClient([snapAccount({ id: "st-401k" })]).client,
        ownerEmail: "nobody@test.internal",
        asOfDate: DAY_1,
      }),
    ).rejects.toThrow(/SNAPTRADE_OWNER_EMAIL/);
    expect(await snaptradeRows()).toHaveLength(0);
  });

  it("is a reported no-op when SnapTrade isn't configured", async () => {
    await expect(
      snapshotSnaptradeAccounts({ client: null, ownerEmail: OWNER_EMAIL, asOfDate: DAY_1 }),
    ).resolves.toEqual({ configured: false, synced: 0, failed: 0, errors: [] });
    await expect(
      snapshotSnaptradeAccounts({
        client: fakeClient([]).client,
        ownerEmail: undefined,
        asOfDate: DAY_1,
      }),
    ).resolves.toMatchObject({ configured: false });
  });

  it("leaves Plaid accounts and their snapshots untouched", async () => {
    const [plaid] = await db.select().from(financialAccount);
    await db.insert(balanceSnapshot).values({
      id: randomUUID(),
      userId: OWNER,
      accountId: plaid!.id,
      asOfDate: DAY_1,
      balance: 321,
    });

    await run([snapAccount({ id: "st-401k", amount: 100 })]);

    const [plaidAfter] = await db
      .select()
      .from(financialAccount)
      .where(eq(financialAccount.id, plaid!.id));
    expect(plaidAfter).toEqual(plaid);
    expect(await snapshotsOf(plaid!.id)).toMatchObject([{ asOfDate: DAY_1, balance: 321 }]);
  });

  it("only ever calls listUserAccounts on SnapTrade", async () => {
    const { client, calls } = fakeClient([snapAccount({ id: "st-401k" })]);
    await snapshotSnaptradeAccounts({ client, ownerEmail: OWNER_EMAIL, asOfDate: DAY_1 });
    expect(calls).toEqual(["accountInformation.listUserAccounts"]);
  });
});

describe("financial_account source identity CHECK", () => {
  it("rejects a row that mixes Plaid and SnapTrade identity", async () => {
    const [item] = await db.select().from(plaidItem);
    const insert = db.insert(financialAccount).values({
      id: randomUUID(),
      userId: OWNER,
      source: "snaptrade",
      snaptradeAccountId: "st-mixed",
      plaidItemId: item!.id,
      plaidAccountId: "p-mixed",
      name: "Mixed",
      type: "investment",
    });
    await expect(insert).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("rejects a SnapTrade row with no SnapTrade id", async () => {
    const insert = db.insert(financialAccount).values({
      id: randomUUID(),
      userId: OWNER,
      source: "snaptrade",
      name: "Orphan",
      type: "investment",
    });
    await expect(insert).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});
