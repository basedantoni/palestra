/**
 * Integration tests: reconnecting a broken bank via Plaid Link update mode (KOI-275).
 *
 * - createLinkToken with a plaidItemId issues an update-mode token for an item
 *   the caller owns (access_token set, no products); foreign item → NOT_FOUND
 * - revoked items can't be repaired in update mode (must be re-linked) →
 *   PRECONDITION_FAILED from both createLinkToken and markItemRepaired
 * - markItemRepaired syncs the item and marks it active only if that sync
 *   succeeds; a failed sync leaves it broken; foreign item → NOT_FOUND
 * - linking a bank stores its institution display name; a failed name lookup
 *   never breaks the link
 * - items linked under another PLAID_ENV are refused before Plaid is called, and
 *   linking tags the item with the running PLAID_ENV (KOI-288)
 * - removeItem is scoped to the caller: foreign id → NOT_FOUND (KOI-288)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  const mockDb = { insert: vi.fn(), update: vi.fn(), delete: vi.fn(), select: vi.fn() };
  const mockPlaid = {
    linkTokenCreate: vi.fn(),
    itemPublicTokenExchange: vi.fn(),
    accountsGet: vi.fn(),
    institutionsGetById: vi.fn(),
    itemRemove: vi.fn(),
  };
  return { mockDb, makeChain, mockSync: vi.fn(), mockPlaid };
});

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

vi.mock("@life-tracker/db", () => ({ db: mockDb }));
vi.mock("../lib/plaid-sync-db", () => ({ syncPlaidItem: mockSync }));
vi.mock("../lib/plaid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/plaid-client")>()),
  getPlaidClient: () => mockPlaid,
  getTokenEncryptionKey: () => KEY,
}));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { appRouter } from "../routers/index";
import { encryptToken } from "../lib/token-encryption";
import { env } from "@life-tracker/env/server";

const OTHER_ENV = env.PLAID_ENV === "production" ? "sandbox" : "production";

const USER_ID = "user-reconnect-1";
const ITEM_ID = "00000000-0000-4000-8000-0000000000c3";
const ACCESS_TOKEN = "access-sandbox-reconnect";

function makeCaller() {
  return appRouter.createCaller({ session: { user: { id: USER_ID } }, db: mockDb } as any);
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

let updateSets: Array<Record<string, unknown>>;
let insertValues: Array<Record<string, unknown>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  updateSets = [];
  insertValues = [];
  mockDb.insert.mockImplementation(() => ({
    values: (values: Record<string, unknown>) => {
      insertValues.push(values);
      return makeChain();
    },
  }));
  mockDb.update.mockImplementation(() => ({
    set: (values: Record<string, unknown>) => {
      updateSets.push(values);
      return makeChain();
    },
  }));
  mockSync.mockResolvedValue({ added: 0, modified: 0, removed: 0 });
});

describe("plaid.createLinkToken update mode", () => {
  it("issues an update-mode token for an owned item using its access token, without products", async () => {
    const query = selectCapturingWhere([
      { accessTokenEnc: encryptToken(ACCESS_TOKEN, KEY), status: "error", plaidEnv: env.PLAID_ENV },
    ]);
    mockPlaid.linkTokenCreate.mockResolvedValueOnce({ data: { link_token: "link-update-1" } });

    const result = await makeCaller().plaid.createLinkToken({ plaidItemId: ITEM_ID });

    expect(result).toEqual({ linkToken: "link-update-1" });
    expect(query.params()).toEqual([ITEM_ID, USER_ID]);
    const req = mockPlaid.linkTokenCreate.mock.calls[0]![0];
    expect(req.access_token).toBe(ACCESS_TOKEN);
    expect(req.products).toBeUndefined();
    expect(req.user).toEqual({ client_user_id: USER_ID });
  });

  it("rejects an item the caller doesn't own with NOT_FOUND and never calls Plaid", async () => {
    const query = selectCapturingWhere([]);

    await expect(makeCaller().plaid.createLinkToken({ plaidItemId: ITEM_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(query.params()).toEqual([ITEM_ID, USER_ID]);
    expect(mockPlaid.linkTokenCreate).not.toHaveBeenCalled();
  });

  it("refuses update mode for a revoked item (Plaid can't repair it) and never calls Plaid", async () => {
    selectCapturingWhere([
      { accessTokenEnc: encryptToken(ACCESS_TOKEN, KEY), status: "revoked", plaidEnv: env.PLAID_ENV },
    ]);

    await expect(makeCaller().plaid.createLinkToken({ plaidItemId: ITEM_ID })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mockPlaid.linkTokenCreate).not.toHaveBeenCalled();
  });

  it("refuses update mode for an item linked under another PLAID_ENV and never calls Plaid", async () => {
    selectCapturingWhere([
      { accessTokenEnc: encryptToken(ACCESS_TOKEN, KEY), status: "error", plaidEnv: OTHER_ENV },
    ]);

    await expect(makeCaller().plaid.createLinkToken({ plaidItemId: ITEM_ID })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: `Linked in ${OTHER_ENV} — switch PLAID_ENV to manage`,
    });
    expect(mockPlaid.linkTokenCreate).not.toHaveBeenCalled();
  });

  it("still creates a fresh-link token with products when no item is given", async () => {
    mockPlaid.linkTokenCreate.mockResolvedValueOnce({ data: { link_token: "link-new-1" } });

    await expect(makeCaller().plaid.createLinkToken()).resolves.toEqual({ linkToken: "link-new-1" });
    const req = mockPlaid.linkTokenCreate.mock.calls[0]![0];
    expect(req.access_token).toBeUndefined();
    expect(req.products).toEqual(["transactions"]);
  });
});

/** Let un-awaited sync kick-offs settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("plaid.markItemRepaired", () => {
  it("syncs an owned broken item and only then marks it active", async () => {
    const query = selectCapturingWhere([{ id: ITEM_ID, status: "error" }]);
    mockSync.mockResolvedValueOnce({ added: 4, modified: 1, removed: 0 });

    await expect(makeCaller().plaid.markItemRepaired({ plaidItemId: ITEM_ID })).resolves.toEqual({
      added: 4,
      modified: 1,
      removed: 0,
    });

    expect(query.params()).toEqual([ITEM_ID, USER_ID]);
    expect(mockSync).toHaveBeenCalledWith(ITEM_ID);
    expect(updateSets).toEqual([{ status: "active" }]);
  });

  it("clears an expiring item once the sync succeeds", async () => {
    selectCapturingWhere([{ id: ITEM_ID, status: "pending_expiration" }]);

    await makeCaller().plaid.markItemRepaired({ plaidItemId: ITEM_ID });

    expect(updateSets).toEqual([{ status: "active" }]);
  });

  it("leaves the item broken and reports an error when the follow-up sync fails", async () => {
    selectCapturingWhere([{ id: ITEM_ID, status: "error" }]);
    mockSync.mockRejectedValueOnce(new Error("ITEM_LOGIN_REQUIRED"));

    await expect(
      makeCaller().plaid.markItemRepaired({ plaidItemId: ITEM_ID }),
    ).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    expect(updateSets).toEqual([]);
  });

  it("refuses a revoked item without syncing or writing", async () => {
    selectCapturingWhere([{ id: ITEM_ID, status: "revoked" }]);

    await expect(
      makeCaller().plaid.markItemRepaired({ plaidItemId: ITEM_ID }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mockSync).not.toHaveBeenCalled();
    expect(updateSets).toEqual([]);
  });

  it("rejects an item the caller doesn't own with NOT_FOUND, writing nothing", async () => {
    selectCapturingWhere([]);

    await expect(
      makeCaller().plaid.markItemRepaired({ plaidItemId: ITEM_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updateSets).toEqual([]);
    expect(mockSync).not.toHaveBeenCalled();
  });
});

function linkSucceeds() {
  mockPlaid.itemPublicTokenExchange.mockResolvedValueOnce({
    data: { access_token: ACCESS_TOKEN, item_id: "plaid-item-1" },
  });
  mockPlaid.accountsGet.mockResolvedValueOnce({
    data: { item: { institution_id: "ins_109508" }, accounts: [] },
  });
  mockDb.select.mockReturnValueOnce(makeChain([{ id: ITEM_ID }]));
}

describe("plaid.exchangePublicToken institution name", () => {
  it("stores the institution's display name on the new item", async () => {
    linkSucceeds();
    mockPlaid.institutionsGetById.mockResolvedValueOnce({
      data: { institution: { name: "First Platypus Bank" } },
    });

    await makeCaller().plaid.exchangePublicToken({ publicToken: "public-1" });
    await flush();

    expect(mockPlaid.institutionsGetById).toHaveBeenCalledWith(
      expect.objectContaining({ institution_id: "ins_109508" }),
    );
    expect(insertValues[0]).toMatchObject({
      institutionId: "ins_109508",
      institutionName: "First Platypus Bank",
      plaidEnv: env.PLAID_ENV,
    });
  });

  it("links without a name when the institution lookup fails", async () => {
    linkSucceeds();
    mockPlaid.institutionsGetById.mockRejectedValueOnce(new Error("INSTITUTION_NOT_FOUND"));

    await expect(
      makeCaller().plaid.exchangePublicToken({ publicToken: "public-1" }),
    ).resolves.toEqual({ itemId: ITEM_ID, accountCount: 0 });
    await flush();

    expect(insertValues[0]).toMatchObject({ institutionName: null });
  });
});

describe("plaid.removeItem", () => {
  it("rejects an item the caller doesn't own with NOT_FOUND, revoking and deleting nothing", async () => {
    const query = selectCapturingWhere([]);

    await expect(
      makeCaller().plaid.removeItem({ plaidItemId: ITEM_ID, force: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(query.params()).toEqual([ITEM_ID, USER_ID]);
    expect(mockPlaid.itemRemove).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
  });
});
