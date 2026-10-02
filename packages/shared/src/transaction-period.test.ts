import { describe, expect, it } from "vitest";

import {
  canStepForward,
  resolvePeriodBounds,
  stepPeriod,
  todayInTimeZone,
} from "./transaction-period";

describe("resolvePeriodBounds", () => {
  it("covers a whole calendar month, inclusive", () => {
    expect(resolvePeriodBounds({ kind: "month", month: "2026-09" }, "2026-10-01")).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("handles February in a leap year", () => {
    expect(resolvePeriodBounds({ kind: "month", month: "2028-02" }, "2028-03-10")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("last 90 days ends today and includes it (90 calendar days)", () => {
    expect(resolvePeriodBounds({ kind: "preset", preset: "90d" }, "2026-10-01")).toEqual({
      from: "2026-07-04",
      to: "2026-10-01",
    });
  });

  it("last 6 months starts the day after the same date six months ago", () => {
    expect(resolvePeriodBounds({ kind: "preset", preset: "6m" }, "2026-10-01")).toEqual({
      from: "2026-04-02",
      to: "2026-10-01",
    });
  });

  it("last 6 months clamps when the earlier month is shorter", () => {
    // Six months before Aug 31 is Feb — no Feb 31, so clamp to Feb 28, start Mar 1.
    expect(resolvePeriodBounds({ kind: "preset", preset: "6m" }, "2026-08-31")).toEqual({
      from: "2026-03-01",
      to: "2026-08-31",
    });
  });

  it("year to date runs from Jan 1 through today", () => {
    expect(resolvePeriodBounds({ kind: "preset", preset: "ytd" }, "2026-10-01")).toEqual({
      from: "2026-01-01",
      to: "2026-10-01",
    });
  });

  it("all time is unbounded", () => {
    expect(resolvePeriodBounds({ kind: "all" }, "2026-10-01")).toEqual({});
  });
});

describe("todayInTimeZone", () => {
  it("uses the user's calendar date, not UTC's", () => {
    // 03:00 UTC on Oct 1 is still the evening of Sep 30 in Chicago.
    expect(todayInTimeZone(new Date("2026-10-01T03:00:00Z"), "America/Chicago")).toBe("2026-09-30");
    expect(todayInTimeZone(new Date("2026-10-01T03:00:00Z"), "UTC")).toBe("2026-10-01");
  });
});

describe("stepPeriod", () => {
  const today = "2026-10-01";

  it("steps months across a year boundary", () => {
    expect(stepPeriod({ kind: "month", month: "2026-01" }, -1, today)).toEqual({
      kind: "month",
      month: "2025-12",
    });
    expect(stepPeriod({ kind: "month", month: "2025-12" }, 1, today)).toEqual({
      kind: "month",
      month: "2026-01",
    });
  });

  it("steps from a shortcut relative to the month its range ends in", () => {
    // Last 90 days ends today (October) → previous month is September.
    expect(stepPeriod({ kind: "preset", preset: "90d" }, -1, today)).toEqual({
      kind: "month",
      month: "2026-09",
    });
  });

  it("never steps into a future month", () => {
    expect(stepPeriod({ kind: "month", month: "2026-10" }, 1, today)).toEqual({
      kind: "month",
      month: "2026-10",
    });
  });

  it("leaves all time unchanged", () => {
    expect(stepPeriod({ kind: "all" }, -1, today)).toEqual({ kind: "all" });
  });
});

describe("canStepForward", () => {
  const today = "2026-10-01";

  it("is false on the current month, on shortcuts ending today, and on all time", () => {
    expect(canStepForward({ kind: "month", month: "2026-10" }, today)).toBe(false);
    expect(canStepForward({ kind: "preset", preset: "ytd" }, today)).toBe(false);
    expect(canStepForward({ kind: "all" }, today)).toBe(false);
  });

  it("is true on a past month", () => {
    expect(canStepForward({ kind: "month", month: "2026-09" }, today)).toBe(true);
  });
});
