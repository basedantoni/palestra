import { describe, expect, it, vi } from "vitest";

const { mockDb, mockGetPlaidClient, mockDecryptToken } = vi.hoisted(() => ({
  mockDb: { select: vi.fn() },
  mockGetPlaidClient: vi.fn(),
  mockDecryptToken: vi.fn(),
}));

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

vi.mock("@life-tracker/db", () => ({ db: mockDb }));
vi.mock("@life-tracker/env/server", () => ({ env: { PLAID_ENV: "sandbox" } }));
vi.mock("./token-encryption", () => ({ decryptToken: mockDecryptToken }));
vi.mock("./plaid-client", () => ({
  getPlaidClient: mockGetPlaidClient,
  getTokenEncryptionKey: () => "key",
}));
vi.mock("./plaid-balance-db", () => ({ persistAccountBalances: vi.fn() }));
vi.mock("./category-rules-db", () => ({
  loadCategoryByName: vi.fn(),
  loadMatchableRules: vi.fn(),
}));

import { syncPlaidItem } from "./plaid-sync-db";

describe("syncPlaidItem", () => {
  // Webhook, startup drain, initial sync, syncNow and repair all route through here.
  it("refuses an item from another Plaid environment before touching its token or Plaid", async () => {
    mockDb.select.mockReturnValueOnce(
      makeChain([{ id: "item-1", userId: "user-1", plaidEnv: "production", accessTokenEnc: "enc" }]),
    );

    await expect(syncPlaidItem("item-1")).rejects.toThrow(
      "Linked in production — switch PLAID_ENV to manage",
    );
    expect(mockDecryptToken).not.toHaveBeenCalled();
    expect(mockGetPlaidClient).not.toHaveBeenCalled();
  });
});
