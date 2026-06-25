import { describe, expect, it } from "vitest";

import { classifyFlow, matchInternalTransfers } from "./transaction-flow";

describe("classifyFlow", () => {
  it("maps INCOME primary to income", () => {
    expect(classifyFlow("INCOME")).toBe("income");
  });

  it("maps TRANSFER_IN / TRANSFER_OUT to transfer", () => {
    expect(classifyFlow("TRANSFER_IN")).toBe("transfer");
    expect(classifyFlow("TRANSFER_OUT")).toBe("transfer");
  });

  it("defaults everything else (and null) to expense", () => {
    expect(classifyFlow("FOOD_AND_DRINK")).toBe("expense");
    expect(classifyFlow("GENERAL_MERCHANDISE")).toBe("expense");
    expect(classifyFlow(null)).toBe("expense");
    expect(classifyFlow(undefined)).toBe("expense");
  });
});

describe("matchInternalTransfers", () => {
  it("pairs an opposite-sign equal-amount move across two accounts within the window", () => {
    // Plaid sign convention: positive = money out of the account.
    const pairs = matchInternalTransfers([
      { id: "out", accountId: "checking", amount: 500, date: new Date("2026-06-10") },
      { id: "in", accountId: "savings", amount: -500, date: new Date("2026-06-11") },
    ]);
    expect(pairs).toEqual([{ transactionIds: ["out", "in"] }]);
  });

  it("matches a credit-card payment (checking → card)", () => {
    const pairs = matchInternalTransfers([
      { id: "pay", accountId: "checking", amount: 1200, date: new Date("2026-06-01") },
      { id: "recv", accountId: "card", amount: -1200, date: new Date("2026-06-01") },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].transactionIds.sort()).toEqual(["pay", "recv"]);
  });

  it("does NOT match same-account or same-sign pairs", () => {
    expect(
      matchInternalTransfers([
        { id: "a", accountId: "checking", amount: 50, date: new Date("2026-06-10") },
        { id: "b", accountId: "checking", amount: -50, date: new Date("2026-06-10") },
      ]),
    ).toEqual([]);
    expect(
      matchInternalTransfers([
        { id: "a", accountId: "checking", amount: 50, date: new Date("2026-06-10") },
        { id: "b", accountId: "savings", amount: 50, date: new Date("2026-06-10") },
      ]),
    ).toEqual([]);
  });

  it("does NOT match when outside the date window", () => {
    expect(
      matchInternalTransfers([
        { id: "a", accountId: "checking", amount: 50, date: new Date("2026-06-01") },
        { id: "b", accountId: "savings", amount: -50, date: new Date("2026-06-30") },
      ]),
    ).toEqual([]);
  });

  it("does NOT match on amount mismatch", () => {
    expect(
      matchInternalTransfers([
        { id: "a", accountId: "checking", amount: 50, date: new Date("2026-06-10") },
        { id: "b", accountId: "savings", amount: -49.99, date: new Date("2026-06-10") },
      ]),
    ).toEqual([]);
  });

  it("uses each transaction in at most one pair", () => {
    const pairs = matchInternalTransfers([
      { id: "out", accountId: "checking", amount: 100, date: new Date("2026-06-10") },
      { id: "in1", accountId: "savings", amount: -100, date: new Date("2026-06-10") },
      { id: "in2", accountId: "brokerage", amount: -100, date: new Date("2026-06-10") },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].transactionIds[0]).toBe("out");
  });
});
