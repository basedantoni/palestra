import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { type PerEur, parseEcbDaily, parseEcbHistory, toUsd } from "./ecb";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name));

describe("parseEcbDaily", () => {
  it("reads the publish day and every currency's units per EUR", () => {
    const { day, rates } = parseEcbDaily(fixture("eurofxref-daily-2026-10-26.xml").toString("utf8"));

    expect(day).toBe("2026-10-26");
    expect(rates.size).toBe(29);
    expect(rates.get("USD")).toBe(1.1188);
    expect(rates.get("JPY")).toBe(176.15);
    expect(rates.get("CNY")).toBe(7.4603);
    expect(rates.get("KRW")).toBe(1482.72);
  });

  it("rejects a response with no rates", () => {
    expect(() => parseEcbDaily("<html>Service unavailable</html>")).toThrow(/no reference rates/i);
  });
});

describe("parseEcbHistory", () => {
  const history = parseEcbHistory(new Uint8Array(fixture("eurofxref-hist.zip")));
  const rate = (day: string, currency: string) =>
    history.find((r) => r.day === day && r.currency === currency)?.perEur;

  it("reads every publish day back to 1999", () => {
    expect(new Set(history.map((r) => r.day))).toEqual(
      new Set(["2026-10-26", "2026-10-23", "2005-04-01", "2005-03-31", "1999-01-04"]),
    );
    expect(rate("1999-01-04", "USD")).toBe(1.1789);
    expect(rate("1999-01-04", "JPY")).toBe(133.73);
    expect(rate("1999-01-04", "KRW")).toBe(1398.59);
    expect(rate("2026-10-26", "USD")).toBe(1.1188);
  });

  it("skips N/A cells: CNY starts on 2005-04-01", () => {
    expect(rate("2005-03-31", "CNY")).toBeUndefined();
    expect(rate("2005-04-01", "CNY")).toBe(10.7255);
    expect(rate("2026-10-26", "CYP")).toBeUndefined();
  });
});

describe("toUsd", () => {
  // 2026-10-26 reference rates.
  const rates: PerEur = new Map([
    ["USD", 1.1188],
    ["JPY", 176.15],
    ["CNY", 7.4603],
    ["KRW", 1482.72],
  ]);

  it("crosses JPY, CNY and KRW to USD through EUR", () => {
    expect(toUsd(1000, "JPY", rates)).toBeCloseTo(6.3514, 4);
    expect(toUsd(100, "CNY", rates)).toBeCloseTo(14.9967, 4);
    expect(toUsd(100_000, "KRW", rates)).toBeCloseTo(75.4559, 4);
  });

  it("converts EUR at the USD rate and leaves USD alone", () => {
    expect(toUsd(10, "EUR", rates)).toBeCloseTo(11.188, 6);
    expect(toUsd(5, "USD", rates)).toBe(5);
  });

  it("has no conversion without a rate for the currency or for USD", () => {
    expect(toUsd(10, "GBP", rates)).toBeNull();
    expect(toUsd(10, "JPY", new Map([["JPY", 176.15]]))).toBeNull();
  });
});
