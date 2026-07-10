import { describe, expect, it } from "vitest";

import { projectGoal } from "./goal-projection";

describe("projectGoal", () => {
  it("reports complete when balance reaches target", () => {
    const r = projectGoal({
      snapshots: [
        { asOfDate: "2026-06-01", balance: 9000 },
        { asOfDate: "2026-06-30", balance: 10000 },
      ],
      target: 10000,
    });
    expect(r.complete).toBe(true);
    expect(r.percent).toBe(100);
    expect(r.onTrack).toBe(true);
  });

  it("projects a completion date from the saving rate", () => {
    // +1000 over 30 days = 33.33/day; need +1000 more → ~30 days past last.
    const r = projectGoal({
      snapshots: [
        { asOfDate: "2026-06-01", balance: 4000 },
        { asOfDate: "2026-07-01", balance: 5000 },
      ],
      target: 6000,
    });
    expect(r.complete).toBe(false);
    expect(r.ratePerDay).toBeCloseTo(1000 / 30, 4);
    expect(r.projectedDate).toBe("2026-07-31");
    expect(r.percent).toBeCloseTo((5000 / 6000) * 100, 4);
  });

  it("marks onTrack false when projected date is past the target date", () => {
    const r = projectGoal({
      snapshots: [
        { asOfDate: "2026-06-01", balance: 4000 },
        { asOfDate: "2026-07-01", balance: 5000 },
      ],
      target: 6000,
      targetDate: "2026-07-15",
    });
    expect(r.projectedDate).toBe("2026-07-31");
    expect(r.onTrack).toBe(false);
  });

  it("cannot project with a flat or negative rate", () => {
    const r = projectGoal({
      snapshots: [
        { asOfDate: "2026-06-01", balance: 5000 },
        { asOfDate: "2026-07-01", balance: 5000 },
      ],
      target: 6000,
    });
    expect(r.ratePerDay).toBe(0);
    expect(r.projectedDate).toBeNull();
    expect(r.onTrack).toBeNull();
  });

  it("cannot project from a single snapshot", () => {
    const r = projectGoal({
      snapshots: [{ asOfDate: "2026-06-01", balance: 5000 }],
      target: 6000,
    });
    expect(r.currentBalance).toBe(5000);
    expect(r.projectedDate).toBeNull();
  });
});
