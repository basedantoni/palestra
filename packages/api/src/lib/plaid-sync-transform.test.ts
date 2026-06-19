import { describe, expect, it } from "vitest";

import { applyTransactionSyncDelta } from "./plaid-sync-transform";

const txn = (over: Record<string, unknown> = {}) => ({
  transaction_id: "t1",
  account_id: "acc_1",
  amount: 12.34,
  date: "2026-06-10",
  name: "Coffee Shop",
  merchant_name: "Blue Bottle",
  pending: false,
  personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE" },
  iso_currency_code: "USD",
  ...over,
});

describe("applyTransactionSyncDelta", () => {
  it("maps added + modified into transaction upserts", () => {
    const out = applyTransactionSyncDelta({
      added: [txn()],
      modified: [txn({ transaction_id: "t2", amount: 99, merchant_name: null })],
      removed: [],
      accounts: [],
      asOfDate: "2026-06-10",
    });

    expect(out.upserts).toHaveLength(2);
    expect(out.upserts[0]).toMatchObject({
      plaidTransactionId: "t1",
      plaidAccountId: "acc_1",
      amount: 12.34,
      name: "Coffee Shop",
      merchantName: "Blue Bottle",
      pending: false,
      plaidCategoryPrimary: "FOOD_AND_DRINK",
      plaidCategoryDetailed: "FOOD_AND_DRINK_COFFEE",
      isoCurrencyCode: "USD",
    });
    expect(out.upserts[0].date).toBeInstanceOf(Date);
    expect(out.upserts[0].date.toISOString().slice(0, 10)).toBe("2026-06-10");
    expect(out.upserts[1].merchantName).toBeNull();
  });

  it("collects removed transaction ids into deletes", () => {
    const out = applyTransactionSyncDelta({
      added: [],
      modified: [],
      removed: [{ transaction_id: "gone1" }, { transaction_id: "gone2" }],
      accounts: [],
      asOfDate: "2026-06-10",
    });
    expect(out.deletes).toEqual(["gone1", "gone2"]);
  });

  it("derives account balance updates and a daily snapshot per account", () => {
    const out = applyTransactionSyncDelta({
      added: [],
      modified: [],
      removed: [],
      accounts: [
        {
          account_id: "acc_1",
          balances: { current: 500.5, available: 480, iso_currency_code: "USD" },
        },
      ],
      asOfDate: "2026-06-10",
    });

    expect(out.accountBalances).toEqual([
      { plaidAccountId: "acc_1", current: 500.5, available: 480, isoCurrencyCode: "USD" },
    ]);
    expect(out.snapshots).toEqual([
      { plaidAccountId: "acc_1", asOfDate: "2026-06-10", balance: 500.5 },
    ]);
  });

  it("skips the snapshot when current balance is null but still records the balance row", () => {
    const out = applyTransactionSyncDelta({
      added: [],
      modified: [],
      removed: [],
      accounts: [{ account_id: "acc_2", balances: { current: null, available: null } }],
      asOfDate: "2026-06-10",
    });
    expect(out.accountBalances).toHaveLength(1);
    expect(out.snapshots).toHaveLength(0);
  });

  it("tolerates missing merchant_name and personal_finance_category", () => {
    const out = applyTransactionSyncDelta({
      added: [
        {
          transaction_id: "t9",
          account_id: "acc_1",
          amount: 5,
          date: "2026-06-01",
          name: "Unknown",
        },
      ],
      modified: [],
      removed: [],
      accounts: [],
      asOfDate: "2026-06-10",
    });
    expect(out.upserts[0]).toMatchObject({
      merchantName: null,
      plaidCategoryPrimary: null,
      plaidCategoryDetailed: null,
      isoCurrencyCode: null,
      pending: false,
    });
  });
});
