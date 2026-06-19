import { describe, expect, it } from "vitest";

import {
  resolveAnalyticsDateBounds,
  resolveClampedWorkoutFrequencyBounds,
} from "./analytics-bounds";

describe("resolveAnalyticsDateBounds", () => {
  it("uses global filter from/to strings when provided", () => {
    expect(
      resolveAnalyticsDateBounds({
        from: "2026-02-01",
        to: "2026-02-28",
        startDate: new Date("2026-01-01T12:00:00.000Z"),
        endDate: new Date("2026-01-31T12:00:00.000Z"),
      }),
    ).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("preserves legacy startDate/endDate inputs when global bounds are absent", () => {
    const startDate = new Date(2026, 3, 1, 12, 0, 0);
    const endDate = new Date(2026, 3, 30, 12, 0, 0);

    expect(resolveAnalyticsDateBounds({ startDate, endDate })).toEqual({
      from: undefined,
      to: undefined,
      startDate,
      endDate,
    });
  });
});

describe("resolveClampedWorkoutFrequencyBounds", () => {
  it("defaults to a trailing one-year window when no bounds are provided", () => {
    expect(
      resolveClampedWorkoutFrequencyBounds(undefined, new Date(2026, 5, 19, 12)),
    ).toEqual({
      from: "2025-06-19",
      to: "2026-06-19",
    });
  });

  it("clamps an oversized requested window down to the last readable year", () => {
    expect(
      resolveClampedWorkoutFrequencyBounds(
        {
          from: "2020-01-01",
          to: "2026-06-19",
        },
        new Date(2026, 5, 19, 12),
      ),
    ).toEqual({
      from: "2025-06-19",
      to: "2026-06-19",
    });
  });

  it("preserves shorter requested windows unchanged", () => {
    expect(
      resolveClampedWorkoutFrequencyBounds(
        {
          from: "2026-04-01",
          to: "2026-06-19",
        },
        new Date(2026, 5, 19, 12),
      ),
    ).toEqual({
      from: "2026-04-01",
      to: "2026-06-19",
    });
  });
});
