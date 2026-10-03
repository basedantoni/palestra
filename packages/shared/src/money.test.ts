import { describe, expect, it } from "vitest";

import { isNegativeUsd, signedUsd } from "./money";

describe("signedUsd", () => {
  it("signs whole-dollar amounts", () => {
    expect(signedUsd(1200)).toBe("+$1,200");
    expect(signedUsd(-300)).toBe("-$300");
  });

  it("shows amounts that round to zero as an unsigned $0", () => {
    expect(signedUsd(0)).toBe("$0");
    expect(signedUsd(0.4)).toBe("$0");
    expect(signedUsd(-0.4)).toBe("$0");
  });

  it("takes the sign from the rounded value", () => {
    expect(signedUsd(0.6)).toBe("+$1");
    expect(signedUsd(-0.6)).toBe("-$1");
  });
});

describe("isNegativeUsd", () => {
  it("is true only when the shown (rounded) amount is below zero", () => {
    expect(isNegativeUsd(-0.6)).toBe(true);
    expect(isNegativeUsd(-0.4)).toBe(false);
    expect(isNegativeUsd(-0.5)).toBe(false);
    expect(isNegativeUsd(0)).toBe(false);
  });
});
