import { describe, expect, it, vi } from "vitest";

const { mockGetPlaidClient, mockDecryptToken } = vi.hoisted(() => ({
  mockGetPlaidClient: vi.fn(),
  mockDecryptToken: vi.fn(),
}));

vi.mock("@life-tracker/db", () => import("../__tests__/helpers/mock-db").then((m) => m.mockDbModule));
vi.mock("@life-tracker/env/server", () => ({ env: { PLAID_ENV: "sandbox" } }));
vi.mock("./token-encryption", () => ({ decryptToken: mockDecryptToken }));
vi.mock("./plaid-client", () => ({
  getPlaidClient: mockGetPlaidClient,
  getTokenEncryptionKey: () => "key",
}));
vi.mock("./plaid-balance-db", () => ({ persistAccountBalances: vi.fn() }));
vi.mock("./category-rules-db", () => ({
  ensureSeeded: vi.fn(async () => new Map()),
  loadMatchableRules: vi.fn(),
}));

import { plaidItem } from "@life-tracker/db/schema/index";
import { mockDb } from "../__tests__/helpers/mock-db";
import { syncPlaidItem } from "./plaid-sync-db";

describe("syncPlaidItem", () => {
  // Webhook, startup drain, initial sync, syncNow and repair all route through here.
  it("refuses an item from another Plaid environment before touching its token or Plaid", async () => {
    mockDb.onSelect(plaidItem, [
      { id: "item-1", userId: "user-1", plaidEnv: "production", accessTokenEnc: "enc" },
    ]);

    await expect(syncPlaidItem("item-1")).rejects.toThrow(
      "Linked in production — switch PLAID_ENV to manage",
    );
    expect(mockDecryptToken).not.toHaveBeenCalled();
    expect(mockGetPlaidClient).not.toHaveBeenCalled();
  });
});
