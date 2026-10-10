/**
 * Integration tests: on-demand Plaid sync (KOI-274).
 *
 * - plaid.syncNow syncs every item the caller owns and reports per-item results
 * - one item failing doesn't abort the others; the error is reported per item
 * - revoked items are skipped (Plaid would reject them) and reported as such
 * - items linked under another PLAID_ENV are skipped without calling Plaid (KOI-288)
 * - the item query is scoped to the caller (asserted on the rendered WHERE)
 * - syncNow with a plaidItemId the caller doesn't own → NOT_FOUND, nothing synced
 * - exchangePublicToken kicks off a sync for the new item without waiting on a
 *   webhook, and a sync failure never breaks the link response
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before imports)
// ────────────────────────────────────────────────────────────────────────────
const { mockDb, makeChain, mockSync, mockPlaid } = vi.hoisted(() => {
  function makeChain(resolveWith: unknown = []) {
    const proxy: any = new Proxy(
      {},
      {
        get(_, prop: string) {
          if (prop === "then") return (ok: any) => Promise.resolve(resolveWith).then(ok);
          if (prop === "catch") return (err: any) => Promise.resolve(resolveWith).catch(err);
          if (prop === "finally") return (fin: any) => Promise.resolve(resolveWith).finally(fin);
          return () => proxy;
        },
      },
    );
    return proxy;
  }

  const mockDb = {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    select: vi.fn(),
  };

  const mockPlaid = {
    itemPublicTokenExchange: vi.fn(),
    accountsGet: vi.fn(),
  };

  return { mockDb, makeChain, mockSync: vi.fn(), mockPlaid };
});

vi.mock("@life-tracker/db", () => ({ db: mockDb }));
vi.mock("../lib/plaid-sync-db", () => ({ syncPlaidItem: mockSync }));
vi.mock("../lib/plaid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/plaid-client")>()),
  getPlaidClient: () => mockPlaid,
  getTokenEncryptionKey: () =>
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
}));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { appRouter } from "../routers/index";
import { env } from "@life-tracker/env/server";
import { otherPlaidEnv } from "../lib/plaid-env";

const OTHER_ENV = otherPlaidEnv();

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const USER_ID = "user-plaid-1";
const ITEM_A = "00000000-0000-4000-8000-0000000000a1";
const ITEM_B = "00000000-0000-4000-8000-0000000000b2";

function makeCaller(userId = USER_ID) {
  return appRouter.createCaller({ session: { user: { id: userId } }, db: mockDb } as any);
}

/** Next db.select() resolves to these rows. */
function selectReturns(rows: unknown[]) {
  mockDb.select.mockReturnValueOnce(makeChain(rows));
}

/**
 * Next db.select() resolves to these rows and records its WHERE clause, so
 * tests can prove the query itself is scoped (the mock ignores filters).
 */
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

function item(id: string, status = "active", plaidEnv = env.PLAID_ENV) {
  return { id, institutionName: `Bank ${id.slice(-2)}`, status, plaidEnv };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockDb.insert.mockImplementation(() => makeChain());
  mockDb.update.mockImplementation(() => makeChain());
});

// ────────────────────────────────────────────────────────────────────────────
// plaid.syncNow
// ────────────────────────────────────────────────────────────────────────────
describe("plaid.syncNow", () => {
  it("syncs every item the caller owns and reports per-item counts", async () => {
    const query = selectCapturingWhere([item(ITEM_A), item(ITEM_B)]);
    mockSync
      .mockResolvedValueOnce({ added: 3, modified: 1, removed: 0 })
      .mockResolvedValueOnce({ added: 0, modified: 0, removed: 2 });

    const result = await makeCaller().plaid.syncNow({});

    expect(mockSync).toHaveBeenCalledWith(ITEM_A);
    expect(mockSync).toHaveBeenCalledWith(ITEM_B);
    expect(query.params()).toEqual([USER_ID]);
    expect(result).toEqual([
      { plaidItemId: ITEM_A, institutionName: "Bank a1", ok: true, added: 3, modified: 1, removed: 0 },
      { plaidItemId: ITEM_B, institutionName: "Bank b2", ok: true, added: 0, modified: 0, removed: 2 },
    ]);
  });

  it("keeps syncing other items when one fails, reporting the error for that item", async () => {
    selectReturns([item(ITEM_A), item(ITEM_B)]);
    mockSync
      .mockRejectedValueOnce(new Error("ITEM_LOGIN_REQUIRED"))
      .mockResolvedValueOnce({ added: 1, modified: 0, removed: 0 });

    const result = await makeCaller().plaid.syncNow({});

    expect(result).toEqual([
      { plaidItemId: ITEM_A, institutionName: "Bank a1", ok: false, error: "ITEM_LOGIN_REQUIRED" },
      { plaidItemId: ITEM_B, institutionName: "Bank b2", ok: true, added: 1, modified: 0, removed: 0 },
    ]);
  });

  it("skips revoked items without calling Plaid, reporting them as needing reconnect", async () => {
    selectReturns([item(ITEM_A, "revoked")]);

    const result = await makeCaller().plaid.syncNow({});

    expect(mockSync).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        plaidItemId: ITEM_A,
        institutionName: "Bank a1",
        ok: false,
        error: "Access revoked — reconnect this bank",
      },
    ]);
  });

  it("skips items linked under another PLAID_ENV without calling Plaid", async () => {
    selectReturns([item(ITEM_A), item(ITEM_B, "active", OTHER_ENV)]);
    mockSync.mockResolvedValueOnce({ added: 1, modified: 0, removed: 0 });

    const result = await makeCaller().plaid.syncNow({});

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith(ITEM_A);
    expect(result).toEqual([
      { plaidItemId: ITEM_A, institutionName: "Bank a1", ok: true, added: 1, modified: 0, removed: 0 },
      {
        plaidItemId: ITEM_B,
        institutionName: "Bank b2",
        ok: false,
        skipped: true,
        error: `Linked in ${OTHER_ENV} — switch PLAID_ENV to manage`,
      },
    ]);
  });

  it("reports a foreign revoked item as skipped, not as needing reconnect", async () => {
    selectReturns([item(ITEM_A, "revoked", OTHER_ENV)]);

    const [result] = await makeCaller().plaid.syncNow({});

    expect(result).toMatchObject({ ok: false, skipped: true });
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("syncs only the requested item when given an id the caller owns", async () => {
    const query = selectCapturingWhere([item(ITEM_A)]);
    mockSync.mockResolvedValueOnce({ added: 2, modified: 0, removed: 0 });

    const result = await makeCaller().plaid.syncNow({ plaidItemId: ITEM_A });

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith(ITEM_A);
    expect(query.params()).toEqual([USER_ID, ITEM_A]);
    expect(result).toEqual([
      { plaidItemId: ITEM_A, institutionName: "Bank a1", ok: true, added: 2, modified: 0, removed: 0 },
    ]);
  });

  it("rejects an item id the caller doesn't own with NOT_FOUND and syncs nothing", async () => {
    const query = selectCapturingWhere([]);

    await expect(makeCaller().plaid.syncNow({ plaidItemId: ITEM_B })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(query.params()).toEqual([USER_ID, ITEM_B]);
    expect(mockSync).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// plaid.exchangePublicToken → initial sync
// ────────────────────────────────────────────────────────────────────────────
function linkSucceeds() {
  mockPlaid.itemPublicTokenExchange.mockResolvedValueOnce({
    data: { access_token: "access-sandbox-xyz", item_id: "plaid-item-xyz" },
  });
  mockPlaid.accountsGet.mockResolvedValueOnce({
    data: { item: { institution_id: "ins_1" }, accounts: [] },
  });
  // Resolve the persisted item row id.
  selectReturns([{ id: ITEM_A }]);
}

/** Let the un-awaited sync kick-off settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("plaid.exchangePublicToken initial sync", () => {
  it("kicks off a sync for the newly linked item without waiting on a webhook", async () => {
    linkSucceeds();
    mockSync.mockResolvedValueOnce({ added: 10, modified: 0, removed: 0 });

    const result = await makeCaller().plaid.exchangePublicToken({ publicToken: "public-xyz" });
    await flush();

    expect(result).toEqual({ itemId: ITEM_A, accountCount: 0 });
    expect(mockSync).toHaveBeenCalledWith(ITEM_A);
  });

  it("still returns the link result when the initial sync fails", async () => {
    linkSucceeds();
    mockSync.mockRejectedValueOnce(new Error("PRODUCT_NOT_READY"));

    await expect(
      makeCaller().plaid.exchangePublicToken({ publicToken: "public-xyz" }),
    ).resolves.toEqual({ itemId: ITEM_A, accountCount: 0 });
    await flush();

    expect(mockSync).toHaveBeenCalledWith(ITEM_A);
  });
});
