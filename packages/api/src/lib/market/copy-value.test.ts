import { describe, expect, it } from "vitest";

import { copyValues, totalGain } from "./copy-value";

const TODAY = "2026-10-27";

describe("copyValues", () => {
  it("takes the lowest Current Market Price at the Copy's Condition or better, flagging where it came from", () => {
    const prices = [
      { condition: "NM" as const, day: TODAY, price: 30 },
      { condition: "LP" as const, day: TODAY, price: 25 },
      { condition: "MP" as const, day: TODAY, price: 28 },
      { condition: "HP" as const, day: TODAY, price: 5 },
    ];

    expect(copyValues("MP", prices, [TODAY], [1])).toEqual([{ usd: 25, pricedAt: "LP", day: TODAY, asOf: false }]);
  });

  it("prices an LP Copy with only an NM price at NM", () => {
    expect(copyValues("LP", [{ condition: "NM", day: TODAY, price: 30 }], [TODAY], [1])).toEqual([
      { usd: 30, pricedAt: "NM", day: TODAY, asOf: false },
    ]);
  });

  it("keeps the Copy's own Condition on a tie with a better one", () => {
    const prices = [
      { condition: "NM" as const, day: TODAY, price: 10 },
      { condition: "LP" as const, day: TODAY, price: 10 },
    ];
    expect(copyValues("LP", prices, [TODAY], [1])[0]).toMatchObject({ pricedAt: "LP" });
  });

  it("is unpriced with only worse Conditions, a price over 30 days old, or no rate", () => {
    expect(copyValues("NM", [{ condition: "LP", day: TODAY, price: 5 }], [TODAY], [1])).toEqual([null]);
    expect(copyValues("NM", [{ condition: "NM", day: "2026-09-26", price: 5 }], [TODAY], [1])).toEqual([null]);
    expect(copyValues("NM", [{ condition: "NM", day: TODAY, price: 5 }], [TODAY], [null])).toEqual([null]);
  });

  it("shows 'as of' once the price is over 7 days old", () => {
    expect(copyValues("NM", [{ condition: "NM", day: "2026-10-19", price: 5 }], [TODAY], [1])).toEqual([
      { usd: 5, pricedAt: "NM", day: "2026-10-19", asOf: true },
    ]);
  });

  it("values each day at that day's prices and rate", () => {
    const prices = [
      { condition: "NM" as const, day: "2026-10-25", price: 10 },
      { condition: "LP" as const, day: "2026-10-26", price: 8 },
      { condition: "NM" as const, day: "2026-10-27", price: 7 },
    ];
    const days = ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"];

    expect(copyValues("LP", prices, days, [1, 1, 2, 2]).map((v) => v && [v.usd, v.pricedAt])).toEqual([
      null,
      [10, "NM"],
      [16, "LP"],
      [14, "NM"],
    ]);
  });
});

describe("totalGain", () => {
  it("sums Copy Value minus price paid over Copies with both, as dollars and percent of paid", () => {
    expect(
      totalGain([
        { usd: 30, pricePaid: 20 },
        { usd: 15, pricePaid: 20 },
        { usd: 50, pricePaid: null }, // a gift
        { usd: null, pricePaid: 10 }, // unpriced
      ]),
    ).toEqual({ usd: 5, percent: 12.5, copies: 2 });
  });

  it("is null with no Copy having both", () => {
    expect(totalGain([{ usd: 50, pricePaid: null }])).toBeNull();
  });

  it("has no percent when everything counted was free", () => {
    expect(totalGain([{ usd: 5, pricePaid: 0 }])).toEqual({ usd: 5, percent: null, copies: 1 });
  });
});
