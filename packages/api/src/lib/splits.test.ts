import { describe, expect, it } from "vitest";

import { remainingToAssign, validateSplit } from "./splits";

const parent = { amount: 100, pending: false, flow: "expense" as const, transferPairId: null, parentTransactionId: null };

describe("validateSplit", () => {
  it("accepts two or more pieces summing to the parent", () => {
    expect(validateSplit(parent, [{ amount: 60 }, { amount: 40 }])).toEqual({ ok: true });
  });

  it("compares in cents, so float drift doesn't reject a balanced split", () => {
    expect(validateSplit({ ...parent, amount: 0.3 }, [{ amount: 0.1 }, { amount: 0.2 }])).toEqual({ ok: true });
  });

  it("rejects pieces that don't sum to the parent to the cent", () => {
    expect(validateSplit(parent, [{ amount: 60 }, { amount: 39.99 }])).toEqual({
      ok: false,
      reason: "Splits must add up to $100.00 ($0.01 left to assign)",
    });
  });

  it("rejects fewer than two pieces", () => {
    expect(validateSplit(parent, [{ amount: 100 }])).toEqual({ ok: false, reason: "A split needs at least 2 pieces" });
  });

  it.each([
    ["pending", { pending: true }, "Pending transactions can't be split until they post"],
    ["not an expense", { flow: "income" as const }, "Only expenses can be split"],
    ["no flow yet", { flow: null }, "Only expenses can be split"],
    ["in a Transfer Pair", { transferPairId: "pair-1" }, "Matched transfers can't be split"],
    ["itself a Split", { parentTransactionId: "parent-1" }, "A split piece can't be split again"],
  ])("rejects a parent that is %s", (_, change, reason) => {
    expect(validateSplit({ ...parent, ...change }, [{ amount: 60 }, { amount: 40 }])).toEqual({ ok: false, reason });
  });
});

describe("remainingToAssign", () => {
  it("is what the pieces leave of the parent, rounded to the cent", () => {
    expect(remainingToAssign(100, [{ amount: 33.33 }, { amount: 33.33 }])).toBe(33.34);
    expect(remainingToAssign(0.3, [{ amount: 0.1 }, { amount: 0.2 }])).toBe(0);
    expect(remainingToAssign(50, [{ amount: 60 }])).toBe(-10);
  });
});
