import { describe, expect, it } from "vitest";

import { accountBalanceMutations, applyTransactionSyncDelta } from "./plaid-sync-transform";

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
    expect(out.upserts[0]!.date).toBeInstanceOf(Date);
    expect(out.upserts[0]!.date.toISOString().slice(0, 10)).toBe("2026-06-10");
    expect(out.upserts[1]!.merchantName).toBeNull();
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

const acct = (id: string, current: number | null, available: number | null = null) => ({
  account_id: id,
  balances: { current, available, iso_currency_code: "USD" },
});

describe("accountBalanceMutations", () => {
  it("maps Plaid accounts to one balance update and one snapshot per account for the day", () => {
    const out = accountBalanceMutations(
      [acct("acc_1", 1200.5, 1100), acct("acc_2", -350.25)],
      "2026-10-02",
    );

    expect(out.accountBalances).toEqual([
      { plaidAccountId: "acc_1", current: 1200.5, available: 1100, isoCurrencyCode: "USD" },
      { plaidAccountId: "acc_2", current: -350.25, available: null, isoCurrencyCode: "USD" },
    ]);
    expect(out.snapshots).toEqual([
      { plaidAccountId: "acc_1", asOfDate: "2026-10-02", balance: 1200.5 },
      { plaidAccountId: "acc_2", asOfDate: "2026-10-02", balance: -350.25 },
    ]);
  });

  it("records a zero balance as a snapshot (zero is a balance, not missing)", () => {
    const out = accountBalanceMutations([acct("acc_1", 0)], "2026-10-02");
    expect(out.snapshots).toEqual([{ plaidAccountId: "acc_1", asOfDate: "2026-10-02", balance: 0 }]);
  });

  it("skips the snapshot when Plaid reports no current balance or no balances at all", () => {
    const out = accountBalanceMutations(
      [acct("acc_1", null, 50), { account_id: "acc_2" }],
      "2026-10-02",
    );
    expect(out.snapshots).toEqual([]);
    expect(out.accountBalances).toEqual([
      { plaidAccountId: "acc_1", current: null, available: 50, isoCurrencyCode: "USD" },
      { plaidAccountId: "acc_2", current: null, available: null, isoCurrencyCode: null },
    ]);
  });

  it("returns nothing for an item with no accounts", () => {
    expect(accountBalanceMutations([], "2026-10-02")).toEqual({
      accountBalances: [],
      snapshots: [],
    });
  });
});
