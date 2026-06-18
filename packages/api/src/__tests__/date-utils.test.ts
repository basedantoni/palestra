import { describe, expect, it } from "vitest";

import { isoWeekKey } from "../lib/date-utils";

// ISO weeks start on Monday. The week of Mon 2025-01-06 runs through Sun 2025-01-12.
describe("isoWeekKey", () => {
  it("maps a Wednesday to the Monday of its ISO week", () => {
    expect(isoWeekKey(new Date(2025, 0, 8))).toBe("2025-01-06");
  });

  it("maps a Sunday to the Monday of its ISO week (not the next week)", () => {
    // Sunday is the last day of the ISO week — the naive day-of-week zero case.
    expect(isoWeekKey(new Date(2025, 0, 12))).toBe("2025-01-06");
  });

  it("maps a Monday to itself", () => {
    expect(isoWeekKey(new Date(2025, 0, 6))).toBe("2025-01-06");
  });

  it("returns the same key for two dates in the same ISO week (dedup)", () => {
    const wed = isoWeekKey(new Date(2025, 0, 8));
    const sat = isoWeekKey(new Date(2025, 0, 11));
    expect(wed).toBe(sat);
  });

  it("returns different keys for adjacent ISO weeks (Sunday vs next Monday)", () => {
    const sunday = isoWeekKey(new Date(2025, 0, 12));
    const nextMonday = isoWeekKey(new Date(2025, 0, 13));
    expect(sunday).toBe("2025-01-06");
    expect(nextMonday).toBe("2025-01-13");
    expect(sunday).not.toBe(nextMonday);
  });

  it("does not round-trip through UTC midnight (no off-by-one in zones behind UTC)", () => {
    // A workout timestamped at local Wednesday noon stays in the same week.
    expect(isoWeekKey(new Date(2025, 0, 8, 12, 0, 0))).toBe("2025-01-06");
  });
});
