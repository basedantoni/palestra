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
const { mockPlaid } = vi.hoisted(() => ({
  mockPlaid: { accountsGet: vi.fn(), accountsBalanceGet: vi.fn() },
}));

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));
vi.mock("../lib/token-encryption", () => ({
  decryptToken: (enc: string) => `access-${enc}`,
}));
vi.mock("../lib/plaid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/plaid-client")>()),
  getPlaidClient: () => mockPlaid,
  getTokenEncryptionKey: () =>
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
}));

import { balanceSnapshot, financialAccount, plaidItem } from "@life-tracker/db/schema/index";

import { snapshotAllPlaidBalances } from "../lib/plaid-balance-snapshot";
import { mockDb } from "./helpers/mock-db";

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

/** The non-revoked plaid_item rows the job reads. */
function itemsAre(rows: unknown[]) {
  mockDb.onSelect(plaidItem, rows);
}

/** The next item's linked financial_account rows. */
function linkedAccounts(rows: unknown[]) {
  mockDb.onSelect(financialAccount, rows);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

/** The `values` and `onConflictDoUpdate` args of each snapshot insert. */
function snapshotUpserts() {
  return mockDb.opsOn(balanceSnapshot).map((op) => ({
    values: op.arg("values") as Record<string, unknown>,
    onConflict: op.arg("onConflictDoUpdate") as {
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
    itemsAre([item(ITEM_A)]);
    mockPlaid.accountsGet.mockResolvedValueOnce({
      data: { accounts: [plaidAccount("p_chk", 1500), plaidAccount("p_cc", 420.5)] },
    });
    linkedAccounts([
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
    expect(mockDb.updated(financialAccount)).toHaveLength(2);
  });

  it("skips accounts Plaid reports that aren't linked locally", async () => {
    itemsAre([item(ITEM_A)]);
    mockPlaid.accountsGet.mockResolvedValueOnce({
      data: { accounts: [plaidAccount("p_chk", 10), plaidAccount("p_unknown", 99)] },
    });
    linkedAccounts([{ id: "fa-chk", plaidAccountId: "p_chk" }]);

    await snapshotAllPlaidBalances(TODAY);

    expect(snapshotUpserts().map((u) => u.values.accountId)).toEqual(["fa-chk"]);
    expect(mockDb.updated(financialAccount)).toHaveLength(1);
  });

  it("keeps snapshotting other items when one fails, counting the failure", async () => {
    itemsAre([item(ITEM_A), item(ITEM_B, "user-2")]);
    mockPlaid.accountsGet
      .mockRejectedValueOnce({
        response: { data: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "login required" } },
      })
      .mockResolvedValueOnce({ data: { accounts: [plaidAccount("p_sav", 8000)] } });
    // Item A fails before its account lookup, so this is item B's.
    linkedAccounts([{ id: "fa-sav", plaidAccountId: "p_sav" }]);

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
    const result = await snapshotAllPlaidBalances(TODAY);

    expect(mockDb.selected(plaidItem)).toEqual([["revoked"]]);
    expect(result).toEqual({ snapshotted: 0, failed: 0 });
    expect(mockPlaid.accountsGet).not.toHaveBeenCalled();
  });

  it("scopes the account lookup to the item being snapshotted", async () => {
    itemsAre([item(ITEM_A)]);
    mockPlaid.accountsGet.mockResolvedValueOnce({ data: { accounts: [] } });

    await snapshotAllPlaidBalances(TODAY);

    expect(mockDb.selected(financialAccount)).toEqual([[ITEM_A]]);
  });

  it("defaults the snapshot day to today (UTC)", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-03T10:00:00.000Z") });
    try {
      itemsAre([item(ITEM_A)]);
      mockPlaid.accountsGet.mockResolvedValueOnce({ data: { accounts: [plaidAccount("p_chk", 1)] } });
      linkedAccounts([{ id: "fa-chk", plaidAccountId: "p_chk" }]);

      await snapshotAllPlaidBalances();

      expect(snapshotUpserts()[0]?.values.asOfDate).toBe("2026-10-03");
    } finally {
      vi.useRealTimers();
    }
  });
});
