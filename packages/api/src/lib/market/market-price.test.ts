import { describe, expect, it } from "vitest";

import { priceMove, rangeAvailability, shapeSeries } from "./market-price";

const TODAY = "2026-10-27";
// The 7d window starts 2026-10-20; its start price may be as old as 2026-10-13.

describe("priceMove", () => {
  it("is the percentage change from the start price to the latest price in the window", () => {
    const prices = [
      { day: "2026-10-19", price: 10 },
      { day: "2026-10-20", price: 20 },
      { day: "2026-10-26", price: 24 },
      { day: "2026-10-27", price: 25 },
    ];

    expect(priceMove(prices, TODAY, 7)).toBe(25);
  });

  it("falls back to yesterday's end price when today's capture failed", () => {
    const prices = [
      { day: "2026-10-20", price: 20 },
      { day: "2026-10-26", price: 15 },
    ];

    expect(priceMove(prices, TODAY, 7)).toBe(-25);
  });

  it("has no move when the window has no end price", () => {
    const prices = [
      { day: "2026-10-18", price: 20 },
      { day: "2026-10-20", price: 22 },
    ];

    expect(priceMove(prices, TODAY, 7)).toBeNull();
  });

  it("takes a start price 7 days before the window start, and has no move at 8", () => {
    const end = { day: TODAY, price: 30 };

    expect(priceMove([{ day: "2026-10-13", price: 20 }, end], TODAY, 7)).toBe(50);
    expect(priceMove([{ day: "2026-10-12", price: 20 }, end], TODAY, 7)).toBeNull();
  });

  it("has no move with no start price at all, and ignores prices after today", () => {
    expect(priceMove([{ day: "2026-10-21", price: 20 }, { day: TODAY, price: 30 }], TODAY, 7)).toBeNull();
    expect(priceMove([{ day: "2026-10-20", price: 20 }, { day: "2026-10-28", price: 30 }], TODAY, 7)).toBeNull();
  });
});

const point = (day: string, price = 1) => ({ day, price });

describe("shapeSeries", () => {
  it("joins a 7-day gap, breaks an 8-day gap, and reports the earliest real point", () => {
    const series = shapeSeries([point("2026-10-01"), point("2026-10-08"), point("2026-10-16"), point("2026-10-17")]);

    expect(series).toEqual({
      segments: [
        [point("2026-10-01"), point("2026-10-08")],
        [point("2026-10-16"), point("2026-10-17")],
      ],
      earliest: "2026-10-01",
    });
  });

  it("plots only real points, never filling a day with no row", () => {
    const series = shapeSeries([point("2026-10-01", 5), point("2026-10-04", 8)]);

    expect(series.segments.flat()).toEqual([point("2026-10-01", 5), point("2026-10-04", 8)]);
  });

  it("has no segments and no earliest point with no prices", () => {
    expect(shapeSeries([])).toEqual({ segments: [], earliest: null });
  });
});

describe("rangeAvailability", () => {
  // 3M starts 2026-07-29, 1Y starts 2025-10-27.
  it("enables only 1M with 20 days of history", () => {
    expect(rangeAvailability(["2026-10-08"], TODAY)).toEqual({ "1M": true, "3M": false, "1Y": false, All: false });
  });

  it("enables a range once the earliest real point reaches its start, not a day after", () => {
    expect(rangeAvailability(["2026-07-29"], TODAY)["3M"]).toBe(true);
    expect(rangeAvailability(["2026-07-30"], TODAY)["3M"]).toBe(false);
  });

  it("takes the shown Marketplace that reaches back furthest", () => {
    expect(rangeAvailability(["2026-10-20", "2025-10-27"], TODAY)).toEqual({ "1M": true, "3M": true, "1Y": true, All: true });
  });

  it("enables All once history goes back past 1M, so no real day is out of reach", () => {
    expect(rangeAvailability(["2026-08-28"], TODAY)).toEqual({ "1M": true, "3M": false, "1Y": false, All: true });
    expect(rangeAvailability(["2026-09-27"], TODAY).All).toBe(false);
  });

  it("keeps 1M, the default, with no history at all", () => {
    expect(rangeAvailability([], TODAY)).toEqual({ "1M": true, "3M": false, "1Y": false, All: false });
  });
});
