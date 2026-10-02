/**
 * Integration tests: daily Plaid balance snapshot job (KOI-289).
 *
 * - every non-revoked item is fetched via the free `/accounts/get`, never the
 *   billed `/accounts/balance/get`
 * - one snapshot per account is upserted on (account, day), so a same-day
 *   re-run updates rather than duplicates; account balances are refreshed too
 * - one item failing (e.g. ITEM_LOGIN_REQUIRED) is logged and skipped without
 *   aborting the others
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before imports)
// ────────────────────────────────────────────────────────────────────────────
const { mockDb, makeChain, mockPlaid } = vi.hoisted(() => {
  function makeChain(resolveWith: unknown = [], calls?: Array<[string, unknown[]]>) {
    const proxy: any = new Proxy(
      {},
      {
        get(_, prop: string) {
          if (prop === "then") return (ok: any) => Promise.resolve(resolveWith).then(ok);
          if (prop === "catch") return (err: any) => Promise.resolve(resolveWith).catch(err);
          if (prop === "finally") return (fin: any) => Promise.resolve(resolveWith).finally(fin);
          return (...args: unknown[]) => {
            calls?.push([prop, args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  }

  const mockDb = {
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
  };

  const mockPlaid = {
    accountsGet: vi.fn(),
    accountsBalanceGet: vi.fn(),
  };

  return { mockDb, makeChain, mockPlaid };
});

vi.mock("@life-tracker/db", () => ({ db: mockDb }));
vi.mock("../lib/token-encryption", () => ({
  decryptToken: (enc: string) => `access-${enc}`,
}));
vi.mock("../lib/plaid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/plaid-client")>()),
  getPlaidClient: () => mockPlaid,
  getTokenEncryptionKey: () =>
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
}));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { balanceSnapshot } from "@life-tracker/db/schema/index";

import { snapshotAllPlaidBalances } from "../lib/plaid-balance-snapshot";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const TODAY = "2026-10-02";
const ITEM_A = "00000000-0000-4000-8000-0000000000a1";
const ITEM_B = "00000000-0000-4000-8000-0000000000b2";

function item(id: string, userId = "user-1") {
  return { id, userId, accessTokenEnc: `enc-${id.slice(-2)}` };
}

function plaidAccount(accountId: string, current: number | null) {
  return { account_id: accountId, balances: { current, available: null, iso_currency_code: "USD" } };
}

/** Next db.select() resolves to these rows. */
function selectReturns(rows: unknown[]) {
  mockDb.select.mockReturnValueOnce(makeChain(rows));
}

/** Next db.select() resolves to these rows and records its WHERE clause. */
function selectCapturingWhere(rows: unknown[]): { params: () => unknown[] } {
  let where: SQL | undefined;
  const chain = makeChain(rows);
  mockDb.select.mockReturnValueOnce({
    from: () => ({
      where: (clause: SQL) => {
        where = clause;
        return chain;
      },
    }),
  });
  return { params: () => (where ? new PgDialect().sqlToQuery(where).params : []) };
}

let insertCalls: Array<Array<[string, unknown[]]>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  insertCalls = [];
  mockDb.insert.mockImplementation(() => {
    const calls: Array<[string, unknown[]]> = [];
    insertCalls.push(calls);
    return makeChain([], calls);
  });
  mockDb.update.mockImplementation(() => makeChain());
});

/** The `values` and `onConflictDoUpdate` args of each snapshot insert. */
function snapshotUpserts() {
  return insertCalls.map((calls) => ({
    values: calls.find(([m]) => m === "values")?.[1][0] as Record<string, unknown>,
    onConflict: calls.find(([m]) => m === "onConflictDoUpdate")?.[1][0] as {
      target: unknown[];
      set: Record<string, unknown>;
    },
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// snapshotAllPlaidBalances
// ────────────────────────────────────────────────────────────────────────────
describe("snapshotAllPlaidBalances", () => {
  it("upserts one snapshot per account for today via the free /accounts/get", async () => {
    selectReturns([item(ITEM_A)]);
    mockPlaid.accountsGet.mockResolvedValueOnce({
      data: { accounts: [plaidAccount("p_chk", 1500), plaidAccount("p_cc", 420.5)] },
    });
    selectReturns([
      { id: "fa-chk", plaidAccountId: "p_chk" },
      { id: "fa-cc", plaidAccountId: "p_cc" },
    ]);

    const result = await snapshotAllPlaidBalances(TODAY);

    expect(result).toEqual({ snapshotted: 1, failed: 0 });
    expect(mockPlaid.accountsGet).toHaveBeenCalledWith({ access_token: "access-enc-a1" });
    expect(mockPlaid.accountsBalanceGet).not.toHaveBeenCalled();

    const upserts = snapshotUpserts();
    expect(upserts.map((u) => u.values)).toEqual([
      expect.objectContaining({ userId: "user-1", accountId: "fa-chk", asOfDate: TODAY, balance: 1500 }),
      expect.objectContaining({ userId: "user-1", accountId: "fa-cc", asOfDate: TODAY, balance: 420.5 }),
    ]);
    // Same-day re-run updates the (account, day) row rather than duplicating it.
    for (const u of upserts) {
      expect(u.onConflict.target).toEqual([balanceSnapshot.accountId, balanceSnapshot.asOfDate]);
      expect(u.onConflict.set).toEqual({ balance: u.values.balance });
    }
    // Current balances on financial_account are refreshed too.
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });

  it("skips accounts Plaid reports that aren't linked locally", async () => {
    selectReturns([item(ITEM_A)]);
    mockPlaid.accountsGet.mockResolvedValueOnce({
      data: { accounts: [plaidAccount("p_chk", 10), plaidAccount("p_unknown", 99)] },
    });
    selectReturns([{ id: "fa-chk", plaidAccountId: "p_chk" }]);

    await snapshotAllPlaidBalances(TODAY);

    expect(snapshotUpserts().map((u) => u.values.accountId)).toEqual(["fa-chk"]);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it("keeps snapshotting other items when one fails, counting the failure", async () => {
    selectReturns([item(ITEM_A), item(ITEM_B, "user-2")]);
    mockPlaid.accountsGet
      .mockRejectedValueOnce({
        response: { data: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "login required" } },
      })
      .mockResolvedValueOnce({ data: { accounts: [plaidAccount("p_sav", 8000)] } });
    selectReturns([{ id: "fa-sav", plaidAccountId: "p_sav" }]);

    const result = await snapshotAllPlaidBalances(TODAY);

    expect(result).toEqual({ snapshotted: 1, failed: 1 });
    expect(snapshotUpserts().map((u) => u.values)).toEqual([
      expect.objectContaining({ userId: "user-2", accountId: "fa-sav", balance: 8000 }),
    ]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(ITEM_A),
      expect.stringContaining("ITEM_LOGIN_REQUIRED"),
    );
  });

  it("only selects items that aren't revoked", async () => {
    const query = selectCapturingWhere([]);

    const result = await snapshotAllPlaidBalances(TODAY);

    expect(query.params()).toEqual(["revoked"]);
    expect(result).toEqual({ snapshotted: 0, failed: 0 });
    expect(mockPlaid.accountsGet).not.toHaveBeenCalled();
  });

  it("scopes the account lookup to the item being snapshotted", async () => {
    selectReturns([item(ITEM_A)]);
    mockPlaid.accountsGet.mockResolvedValueOnce({ data: { accounts: [] } });
    const accounts = selectCapturingWhere([]);

    await snapshotAllPlaidBalances(TODAY);

    expect(accounts.params()).toEqual([ITEM_A]);
  });

  it("defaults the snapshot day to today (UTC)", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-03T10:00:00.000Z") });
    try {
      selectReturns([item(ITEM_A)]);
      mockPlaid.accountsGet.mockResolvedValueOnce({ data: { accounts: [plaidAccount("p_chk", 1)] } });
      selectReturns([{ id: "fa-chk", plaidAccountId: "p_chk" }]);

      await snapshotAllPlaidBalances();

      expect(snapshotUpserts()[0]?.values.asOfDate).toBe("2026-10-03");
    } finally {
      vi.useRealTimers();
    }
  });
});
