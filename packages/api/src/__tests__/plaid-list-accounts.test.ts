/**
 * Integration tests: plaid.listAccounts folds pending transactions into each
 * account's balance, so balances agree with the transaction list.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));

import { financialAccount, transaction } from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { mockDb } from "./helpers/mock-db";

const USER_ID = "user-list-accounts";

function makeCaller() {
  return appRouter.createCaller({ session: { user: { id: USER_ID } }, db: mockDb.db } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("plaid.listAccounts", () => {
  it("adds each account's balance with its pending transactions folded in", async () => {
    mockDb.onSelect(financialAccount, [
      { id: "fa-chk", type: "depository", currentBalance: 1298.12 },
      { id: "fa-cc", type: "credit", currentBalance: 878.4 },
      { id: "fa-sav", type: "depository", currentBalance: 8000 },
    ]);
    // Per-account sum of pending amounts (Plaid sign: positive = money out).
    mockDb.onSelect(transaction, [
      { accountId: "fa-chk", amount: 58.12 },
      { accountId: "fa-cc", amount: 34 },
    ]);

    const accounts = await makeCaller().plaid.listAccounts();

    expect(accounts).toEqual([
      expect.objectContaining({ id: "fa-chk", balanceWithPending: 1240 }),
      expect.objectContaining({ id: "fa-cc", balanceWithPending: 912.4 }),
      expect.objectContaining({ id: "fa-sav", balanceWithPending: 8000 }),
    ]);
  });

  it("only sums the caller's pending transactions", async () => {
    await makeCaller().plaid.listAccounts();

    expect(mockDb.selected(financialAccount)).toEqual([[USER_ID]]);
    expect(mockDb.selected(transaction)).toEqual([[USER_ID, true]]);
  });
});
