import { describe, expect, it } from "vitest";

import { mapPlaidAccountType, plaidAccountToRow } from "./plaid-account-map";

describe("mapPlaidAccountType", () => {
  it("passes through the four known enum values", () => {
    expect(mapPlaidAccountType("depository")).toBe("depository");
    expect(mapPlaidAccountType("credit")).toBe("credit");
    expect(mapPlaidAccountType("investment")).toBe("investment");
    expect(mapPlaidAccountType("loan")).toBe("loan");
  });

  it("maps Plaid 'brokerage' to investment", () => {
    expect(mapPlaidAccountType("brokerage")).toBe("investment");
  });

  it("falls back to depository for unknown/other types", () => {
    expect(mapPlaidAccountType("other")).toBe("depository");
    expect(mapPlaidAccountType("something-new")).toBe("depository");
  });
});

describe("plaidAccountToRow", () => {
  const base = {
    account_id: "acc_123",
    name: "Plaid Checking",
    official_name: "Plaid Gold Standard 0% Interest Checking",
    mask: "0000",
    type: "depository",
    subtype: "checking",
    balances: {
      current: 110.5,
      available: 100.25,
      iso_currency_code: "USD",
    },
  };

  it("maps a Plaid account into financial_account insert values", () => {
    const row = plaidAccountToRow(base, {
      userId: "user_1",
      plaidItemId: "item_1",
    });

    expect(row).toMatchObject({
      userId: "user_1",
      plaidItemId: "item_1",
      plaidAccountId: "acc_123",
      name: "Plaid Checking",
      officialName: "Plaid Gold Standard 0% Interest Checking",
      mask: "0000",
      type: "depository",
      subtype: "checking",
      currentBalance: 110.5,
      availableBalance: 100.25,
      isoCurrencyCode: "USD",
    });
  });

  it("tolerates missing optional fields", () => {
    const row = plaidAccountToRow(
      {
        account_id: "acc_x",
        name: "Card",
        type: "credit",
        balances: {},
      },
      { userId: "u", plaidItemId: "i" },
    );

    expect(row.officialName).toBeNull();
    expect(row.mask).toBeNull();
    expect(row.subtype).toBeNull();
    expect(row.currentBalance).toBeNull();
    expect(row.availableBalance).toBeNull();
    expect(row.isoCurrencyCode).toBeNull();
    expect(row.type).toBe("credit");
  });
});
