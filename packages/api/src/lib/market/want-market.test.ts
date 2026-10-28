import { describe, expect, it } from "vitest";

import { offerVsMarket, wantMarketPrice } from "./want-market";

const TODAY = "2026-10-27";

describe("wantMarketPrice", () => {
  it("is the Current Market Price in USD with its 30-day low and high", () => {
    const prices = [
      { day: "2026-09-26", price: 1 },
      { day: "2026-09-27", price: 8 },
      { day: "2026-10-10", price: 14 },
      { day: "2026-10-26", price: 10 },
    ];

    expect(wantMarketPrice(prices, TODAY, 1.25)).toEqual({
      price: 12.5,
      day: "2026-10-26",
      asOf: false,
      low: 10,
      high: 17.5,
    });
  });

  it("flags an 'as of' price older than 7 days", () => {
    expect(wantMarketPrice([{ day: "2026-10-19", price: 5 }], TODAY, 1)).toMatchObject({ price: 5, asOf: true });
  });

  it("has no price without a Current Market Price or a rate to convert it", () => {
    expect(wantMarketPrice([], TODAY, 1)).toBeNull();
    expect(wantMarketPrice([{ day: "2026-09-26", price: 5 }], TODAY, 1)).toBeNull();
    expect(wantMarketPrice([{ day: "2026-10-26", price: 5 }], TODAY, null)).toBeNull();
  });
});

describe("offerVsMarket", () => {
  it("is the delivered price's percentage above or below the market", () => {
    expect(offerVsMarket({ price: 15, seenOn: TODAY }, 12, TODAY)).toEqual({ percent: 25, stale: false });
    expect(offerVsMarket({ price: 9, seenOn: TODAY }, 12, TODAY)).toEqual({ percent: -25, stale: false });
  });

  it("goes stale once the Offer is more than 7 days old", () => {
    expect(offerVsMarket({ price: 12, seenOn: "2026-10-20" }, 12, TODAY)?.stale).toBe(false);
    expect(offerVsMarket({ price: 12, seenOn: "2026-10-19" }, 12, TODAY)?.stale).toBe(true);
  });

  it("has no comparison without a Current Market Price", () => {
    expect(offerVsMarket({ price: 12, seenOn: TODAY }, null, TODAY)).toBeNull();
  });
});
