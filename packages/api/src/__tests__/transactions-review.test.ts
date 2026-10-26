/**
 * Review queue: Unreviewed transactions (KOI-342).
 *
 * - a Plaid sync inserts posted rows unreviewed and pending rows reviewed
 * - markReviewed / markAllReviewed clear Unreviewed, scoped to the caller
 * - unreviewedCount counts the caller's unreviewed rows
 * - setExcluded and setNote clear it. setCategory and setFlow are asserted in
 *   transactions-manual-category / transactions-flow-override; the exact `set`
 *   assertions there and in rules-router / bank-categories-router show that
 *   resetCategory, rule apply and bank remap leave it alone
 * - the feed filters by reviewed
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPlaid } = vi.hoisted(() => ({
  mockPlaid: { transactionsSync: vi.fn(), accountsGet: vi.fn(async () => ({ data: { accounts: [] } })) },
}));

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));
vi.mock("../lib/token-encryption", () => ({ decryptToken: (enc: string) => `access-${enc}` }));
vi.mock("../lib/plaid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/plaid-client")>()),
  getPlaidClient: () => mockPlaid,
  getTokenEncryptionKey: () => "key",
}));

import { financialAccount, plaidItem, transaction } from "@life-tracker/db/schema/index";
import { env } from "@life-tracker/env/server";

import { syncPlaidItem } from "../lib/plaid-sync-db";
import { appRouter } from "../routers/index";
import { mockDb } from "./helpers/mock-db";

const USER_ID = "user-review";
const ITEM_ID = "00000000-0000-4000-8000-0000000000a1";
const TXN_A = "00000000-0000-4000-8000-0000000000f1";
const TXN_B = "00000000-0000-4000-8000-0000000000f2";

function makeCaller() {
  return appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

/** A Plaid transaction as `/transactions/sync` returns it. */
const plaidTxn = (id: string, pending: boolean) => ({
  transaction_id: id,
  account_id: "p_chk",
  amount: 12,
  date: "2026-09-30",
  name: "BLUE BOTTLE",
  pending,
  personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: null },
});

describe("syncPlaidItem", () => {
  it("inserts posted transactions unreviewed and pending ones reviewed", async () => {
    mockDb.onSelect(plaidItem, [
      { id: ITEM_ID, userId: USER_ID, accessTokenEnc: "enc", transactionCursor: null, plaidEnv: env.PLAID_ENV },
    ]);
    mockDb.onSelect(financialAccount, [{ id: "fa-chk", plaidAccountId: "p_chk" }]);
    mockPlaid.transactionsSync.mockResolvedValueOnce({
      data: { added: [plaidTxn("posted", false), plaidTxn("pending", true)], modified: [], removed: [], next_cursor: "c2", has_more: false },
    });

    await syncPlaidItem(ITEM_ID);

    const inserted = mockDb.inserted(transaction) as Array<{ plaidTransactionId: string; reviewed: boolean }>;
    expect(inserted.map((t) => [t.plaidTransactionId, t.reviewed])).toEqual([
      ["posted", false],
      ["pending", true],
    ]);
    // A known row keeps its review state.
    const onConflict = mockDb.opsOn(transaction, "insert")[0]!.arg("onConflictDoUpdate") as { set: object };
    expect(onConflict.set).not.toHaveProperty("reviewed");
  });
});

describe("transactions.markReviewed", () => {
  it("marks the given transactions reviewed, scoped to the caller", async () => {
    await makeCaller().transactions.markReviewed({ ids: [TXN_A, TXN_B] });

    expect(mockDb.updated(transaction)).toEqual([{ set: { reviewed: true }, where: [USER_ID, TXN_A, TXN_B] }]);
  });

  it("rejects an empty list", async () => {
    await expect(makeCaller().transactions.markReviewed({ ids: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockDb.updated(transaction)).toEqual([]);
  });
});

describe("transactions.markAllReviewed", () => {
  it("marks every unreviewed transaction of the caller reviewed", async () => {
    await makeCaller().transactions.markAllReviewed();

    expect(mockDb.updated(transaction)).toEqual([{ set: { reviewed: true }, where: [USER_ID, false] }]);
  });
});

describe("transactions.unreviewedCount", () => {
  it("counts the caller's unreviewed transactions", async () => {
    mockDb.onSelect(transaction, [{ count: 3 }]);

    await expect(makeCaller().transactions.unreviewedCount()).resolves.toBe(3);
    expect(mockDb.selected(transaction)).toEqual([[USER_ID, false]]);
  });
});

describe("manual edits clear Unreviewed", () => {
  it("setExcluded marks the transaction reviewed", async () => {
    await makeCaller().transactions.setExcluded({ id: TXN_A, excluded: true });

    expect(mockDb.updated(transaction)).toEqual([{ set: { excluded: true, reviewed: true }, where: [TXN_A, USER_ID] }]);
  });

  it("setNote marks the transaction reviewed", async () => {
    await makeCaller().transactions.setNote({ id: TXN_A, note: "split with Sam" });

    expect(mockDb.updated(transaction)).toEqual([{ set: { note: "split with Sam", reviewed: true }, where: [TXN_A, USER_ID] }]);
  });
});
