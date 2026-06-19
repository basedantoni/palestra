import { describe, expect, it } from "vitest";

import {
  formatLocalDate,
  normalizeAnalyticsRangeSearch,
  parseLocalDate,
  resolveAnalyticsRangeBounds,
} from "./analytics-date-range";

describe("normalizeAnalyticsRangeSearch", () => {
  it("defaults to 3m when no search params are present", () => {
    expect(normalizeAnalyticsRangeSearch({})).toEqual({ range: "3m" });
  });

  it("treats explicit from/to params as a custom range", () => {
    expect(
      normalizeAnalyticsRangeSearch({
        from: "2026-03-01",
        to: "2026-04-15",
      }),
    ).toEqual({
      range: "custom",
      from: "2026-03-01",
      to: "2026-04-15",
    });
  });

  it("falls back to 3m when a custom range is incomplete", () => {
    expect(
      normalizeAnalyticsRangeSearch({
        range: "custom",
        from: "2026-03-01",
      }),
    ).toEqual({ range: "3m" });
  });

  it("falls back to 3m when custom bounds are reversed", () => {
    expect(
      normalizeAnalyticsRangeSearch({
        range: "custom",
        from: "2026-04-15",
        to: "2026-03-01",
      }),
    ).toEqual({ range: "3m" });
  });
});

describe("resolveAnalyticsRangeBounds", () => {
  const referenceDate = new Date(2026, 5, 19, 8, 30, 0, 0);

  it("returns an unbounded range for all", () => {
    expect(resolveAnalyticsRangeBounds({ range: "all" }, referenceDate)).toEqual(
      {
        range: "all",
      },
    );
  });

  it("resolves 30d to an inclusive local-date window", () => {
    expect(resolveAnalyticsRangeBounds({ range: "30d" }, referenceDate)).toEqual(
      {
        range: "30d",
        from: "2026-05-21",
        to: "2026-06-19",
      },
    );
  });

  it("resolves 3m to a same-day calendar offset", () => {
    expect(resolveAnalyticsRangeBounds({ range: "3m" }, referenceDate)).toEqual(
      {
        range: "3m",
        from: "2026-03-19",
        to: "2026-06-19",
      },
    );
  });
});

describe("local date helpers", () => {
  it("parses YYYY-MM-DD into local noon", () => {
    const date = parseLocalDate("2026-06-19");

    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(5);
    expect(date.getDate()).toBe(19);
    expect(date.getHours()).toBe(12);
  });

  it("formats a local date without a UTC conversion round-trip", () => {
    expect(formatLocalDate(new Date(2026, 5, 19, 12, 0, 0, 0))).toBe(
      "2026-06-19",
    );
  });
});
