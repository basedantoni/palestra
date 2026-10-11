import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockItemRemove } = vi.hoisted(() => ({ mockItemRemove: vi.fn() }));

vi.mock("@life-tracker/db", () => import("../__tests__/helpers/mock-db").then((m) => m.mockDbModule));
vi.mock("@life-tracker/env/server", () => ({ env: { PLAID_ENV: "sandbox" } }));
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
import { mockDb } from "../__tests__/helpers/mock-db";
import {
  isPlaidItemGoneError,
  removeFinancialAccount,
  removePlaidItem,
} from "./plaid-account-remove";

const USER = "user-1";
const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const ITEM = "00000000-0000-4000-8000-0000000000aa";

const TOKEN_ROW = { accessTokenEnc: "enc", plaidEnv: "sandbox" };

function plaidError(code: string) {
  return Object.assign(new Error(code), { response: { data: { error_code: code } } });
}

/** removeFinancialAccount's reads: the account, its siblings, then the item's token row. */
function accountReads(account: unknown[], siblings: unknown[] = [], tokenRow: unknown[] = []) {
  mockDb.onSelect(financialAccount, account, siblings);
  mockDb.onSelect(plaidItem, tokenRow);
}

/** removePlaidItem's reads: the owned item, then its token row. */
function itemReads(owned: unknown[], tokenRow: unknown[] = []) {
  mockDb.onSelect(plaidItem, owned, tokenRow);
}

/** Tables deleted from, in order. */
const deletedTables = () => mockDb.opsOf("delete").map((op) => op.table);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("removeFinancialAccount", () => {
  it("returns removed:false and touches nothing when the account isn't the user's", async () => {
    accountReads([]);

    await expect(removeFinancialAccount(USER, ACCOUNT)).resolves.toEqual({ removed: false });
    expect(deletedTables()).toEqual([]);
    expect(mockItemRemove).not.toHaveBeenCalled();
  });

  it("deletes only the account when the item has other accounts", async () => {
    accountReads([{ id: ACCOUNT, plaidItemId: ITEM }], [{ id: ACCOUNT }, { id: "other" }]);

    await expect(removeFinancialAccount(USER, ACCOUNT)).resolves.toEqual({
      removed: true,
      itemRemoved: false,
    });
    expect(mockItemRemove).not.toHaveBeenCalled();
    expect(deletedTables()).toEqual([financialAccount]);
  });

  it("revokes and deletes the item when removing its last account", async () => {
    accountReads([{ id: ACCOUNT, plaidItemId: ITEM }], [{ id: ACCOUNT }], [TOKEN_ROW]);
    mockItemRemove.mockResolvedValueOnce({});

    await expect(removeFinancialAccount(USER, ACCOUNT)).resolves.toEqual({
      removed: true,
      itemRemoved: true,
    });
    expect(mockItemRemove).toHaveBeenCalledWith({ access_token: "access-token" });
    expect(deletedTables()).toEqual([plaidItem]);
  });

  it("still deletes the item when Plaid reports it already gone", async () => {
    accountReads([{ id: ACCOUNT, plaidItemId: ITEM }], [{ id: ACCOUNT }], [TOKEN_ROW]);
    mockItemRemove.mockRejectedValueOnce(plaidError("ITEM_NOT_FOUND"));

    await expect(removeFinancialAccount(USER, ACCOUNT)).resolves.toEqual({
      removed: true,
      itemRemoved: true,
    });
    expect(deletedTables()).toEqual([plaidItem]);
  });

  it("keeps the item (and its token) when Plaid revoke fails, deleting only the account", async () => {
    accountReads([{ id: ACCOUNT, plaidItemId: ITEM }], [{ id: ACCOUNT }], [TOKEN_ROW]);
    mockItemRemove.mockRejectedValueOnce(plaidError("INTERNAL_SERVER_ERROR"));

    await expect(removeFinancialAccount(USER, ACCOUNT)).resolves.toEqual({
      removed: true,
      itemRemoved: false,
    });
    expect(deletedTables()).toEqual([financialAccount]);
  });
});

describe("removePlaidItem", () => {
  it("returns notFound and touches nothing for an item the user doesn't own", async () => {
    itemReads([]);

    await expect(removePlaidItem(USER, ITEM, true)).resolves.toEqual({
      removed: false,
      notFound: true,
    });
    expect(mockItemRemove).not.toHaveBeenCalled();
    expect(deletedTables()).toEqual([]);
  });

  it("revokes at Plaid, then deletes the item", async () => {
    itemReads([{ id: ITEM }], [TOKEN_ROW]);
    mockItemRemove.mockResolvedValueOnce({});

    await expect(removePlaidItem(USER, ITEM, false)).resolves.toEqual({
      removed: true,
      revoked: true,
    });
    expect(mockItemRemove).toHaveBeenCalledWith({ access_token: "access-token" });
    expect(deletedTables()).toEqual([plaidItem]);
  });

  it("deletes the item when Plaid reports it already gone", async () => {
    itemReads([{ id: ITEM }], [TOKEN_ROW]);
    mockItemRemove.mockRejectedValueOnce(plaidError("ITEM_NOT_FOUND"));

    await expect(removePlaidItem(USER, ITEM, false)).resolves.toEqual({
      removed: true,
      revoked: true,
    });
    expect(deletedTables()).toEqual([plaidItem]);
  });

  it("keeps the item and returns the error when revoke fails without force", async () => {
    itemReads([{ id: ITEM }], [TOKEN_ROW]);
    mockItemRemove.mockRejectedValueOnce(plaidError("INVALID_ACCESS_TOKEN"));

    const result = await removePlaidItem(USER, ITEM, false);

    expect(result).toMatchObject({ removed: false, notFound: false });
    expect(result).toHaveProperty("error", expect.stringContaining("INVALID_ACCESS_TOKEN"));
    expect(deletedTables()).toEqual([]);
  });

  it("deletes the item anyway when revoke fails with force", async () => {
    itemReads([{ id: ITEM }], [TOKEN_ROW]);
    mockItemRemove.mockRejectedValueOnce(plaidError("INVALID_ACCESS_TOKEN"));

    await expect(removePlaidItem(USER, ITEM, true)).resolves.toEqual({
      removed: true,
      revoked: false,
    });
    expect(deletedTables()).toEqual([plaidItem]);
  });

  it("never sends a foreign-environment token to Plaid", async () => {
    itemReads([{ id: ITEM }], [{ ...TOKEN_ROW, plaidEnv: "production" }]);

    await expect(removePlaidItem(USER, ITEM, false)).resolves.toEqual({
      removed: false,
      notFound: false,
      error: "Linked in production — switch PLAID_ENV to manage",
    });
    expect(mockItemRemove).not.toHaveBeenCalled();
    expect(deletedTables()).toEqual([]);
  });
});

describe("isPlaidItemGoneError", () => {
  it("matches ITEM_NOT_FOUND only", () => {
    expect(isPlaidItemGoneError(plaidError("ITEM_NOT_FOUND"))).toBe(true);
    expect(isPlaidItemGoneError(plaidError("RATE_LIMIT_EXCEEDED"))).toBe(false);
    expect(isPlaidItemGoneError(new Error("boom"))).toBe(false);
  });
});
