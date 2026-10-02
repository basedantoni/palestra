import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, makeChain, mockItemRemove } = vi.hoisted(() => {
  function makeChain(resolveWith: unknown = []) {
    const proxy: any = new Proxy(
      {},
      {
        get(_, prop: string) {
          if (prop === "then") return (ok: any) => Promise.resolve(resolveWith).then(ok);
          return () => proxy;
        },
      },
    );
    return proxy;
  }

  const mockDb = { select: vi.fn(), delete: vi.fn() };
  return { mockDb, makeChain, mockItemRemove: vi.fn() };
});

vi.mock("@life-tracker/db", () => ({ db: mockDb }));
vi.mock("@life-tracker/db/schema/index", () => ({
  financialAccount: { _: "financialAccount" },
  plaidItem: { _: "plaidItem" },
}));
vi.mock("./token-encryption", () => ({ decryptToken: () => "access-token" }));
vi.mock("./plaid-client", () => ({
  getPlaidClient: () => ({ itemRemove: mockItemRemove }),
  getTokenEncryptionKey: () => "key",
  describePlaidError: (err: unknown) => String(err),
}));

import { financialAccount, plaidItem } from "@life-tracker/db/schema/index";
import { isPlaidItemGoneError, removeFinancialAccount } from "./plaid-account-remove";

const USER = "user-1";
const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const ITEM = "00000000-0000-4000-8000-0000000000aa";

function plaidError(code: string) {
  return Object.assign(new Error(code), { response: { data: { error_code: code } } });
}

/** Queue the results of successive db.select() calls. */
function selects(...results: unknown[][]) {
  for (const r of results) mockDb.select.mockReturnValueOnce(makeChain(r));
}

let deletedTables: unknown[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  deletedTables = [];
  mockDb.delete.mockImplementation((table: unknown) => {
    deletedTables.push(table);
    return makeChain();
  });
});

describe("removeFinancialAccount", () => {
  it("returns removed:false and touches nothing when the account isn't the user's", async () => {
    selects([]);

    await expect(removeFinancialAccount(USER, ACCOUNT)).resolves.toEqual({ removed: false });
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockItemRemove).not.toHaveBeenCalled();
  });

  it("deletes only the account when the item has other accounts", async () => {
    selects([{ id: ACCOUNT, plaidItemId: ITEM }], [{ id: ACCOUNT }, { id: "other" }]);

    await expect(removeFinancialAccount(USER, ACCOUNT)).resolves.toEqual({
      removed: true,
      itemRemoved: false,
    });
    expect(mockItemRemove).not.toHaveBeenCalled();
    expect(deletedTables).toEqual([financialAccount]);
  });

  it("revokes and deletes the item when removing its last account", async () => {
    selects([{ id: ACCOUNT, plaidItemId: ITEM }], [{ id: ACCOUNT }], [{ accessTokenEnc: "enc" }]);
    mockItemRemove.mockResolvedValueOnce({});

    await expect(removeFinancialAccount(USER, ACCOUNT)).resolves.toEqual({
      removed: true,
      itemRemoved: true,
    });
    expect(mockItemRemove).toHaveBeenCalledWith({ access_token: "access-token" });
    expect(deletedTables).toEqual([plaidItem]);
  });

  it("still deletes the item when Plaid reports it already gone", async () => {
    selects([{ id: ACCOUNT, plaidItemId: ITEM }], [{ id: ACCOUNT }], [{ accessTokenEnc: "enc" }]);
    mockItemRemove.mockRejectedValueOnce(plaidError("ITEM_NOT_FOUND"));

    await expect(removeFinancialAccount(USER, ACCOUNT)).resolves.toEqual({
      removed: true,
      itemRemoved: true,
    });
    expect(deletedTables).toEqual([plaidItem]);
  });

  it("keeps the item (and its token) when Plaid revoke fails, deleting only the account", async () => {
    selects([{ id: ACCOUNT, plaidItemId: ITEM }], [{ id: ACCOUNT }], [{ accessTokenEnc: "enc" }]);
    mockItemRemove.mockRejectedValueOnce(plaidError("INTERNAL_SERVER_ERROR"));

    await expect(removeFinancialAccount(USER, ACCOUNT)).resolves.toEqual({
      removed: true,
      itemRemoved: false,
    });
    expect(deletedTables).toEqual([financialAccount]);
  });
});

describe("isPlaidItemGoneError", () => {
  it("matches ITEM_NOT_FOUND only", () => {
    expect(isPlaidItemGoneError(plaidError("ITEM_NOT_FOUND"))).toBe(true);
    expect(isPlaidItemGoneError(plaidError("RATE_LIMIT_EXCEEDED"))).toBe(false);
    expect(isPlaidItemGoneError(new Error("boom"))).toBe(false);
  });
});
