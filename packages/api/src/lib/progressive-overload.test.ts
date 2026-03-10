import { describe, it, expect } from "vitest";
import {
  roundToNearestIncrement,
  buildSessionSnapshot,
  detectTrend,
  generateSuggestion,
  analyzeProgressiveOverload,
} from "./progressive-overload";
import type { ExerciseSessionSnapshot } from "./progressive-overload";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(
  date: Date,
  sets: Array<{ reps: number; weight: number; rpe?: number | null; durationSeconds?: number | null }>,
): ExerciseSessionSnapshot {
  const validSets = sets.map((s) => ({
    reps: s.reps,
    weight: s.weight,
    rpe: s.rpe ?? null,
    durationSeconds: null,
  }));
  const totalVolume = validSets.reduce((sum, s) => sum + s.reps * s.weight, 0);
  const topSetWeight =
    validSets.length > 0 ? Math.max(...validSets.map((s) => s.weight)) : 0;
  const topSetReps =
    validSets.length > 0 ? Math.max(...validSets.map((s) => s.reps)) : 0;
  const rpeSets = validSets.filter((s) => s.rpe != null);
  const averageRpe =
    rpeSets.length > 0
      ? rpeSets.reduce((sum, s) => sum + s.rpe!, 0) / rpeSets.length
      : null;
  return {
    date,
    sets: validSets,
    totalVolume,
    topSetWeight,
    topSetReps,
    topSetDuration: 0,
    averageRpe,
    numberOfSets: validSets.length,
  };
}

const D1 = new Date("2024-01-01");
const D2 = new Date("2024-01-08");
const D3 = new Date("2024-01-15");
const D4 = new Date("2024-01-22");
const D5 = new Date("2024-01-29");

// ---------------------------------------------------------------------------
// roundToNearestIncrement
// ---------------------------------------------------------------------------

describe("progressive-overload", () => {
  describe("roundToNearestIncrement", () => {
    it("should round lbs to nearest 2.5", () => {
      expect(roundToNearestIncrement(141, "lbs")).toBe(140);
      expect(roundToNearestIncrement(142, "lbs")).toBe(142.5);
      expect(roundToNearestIncrement(143, "lbs")).toBe(142.5);
      expect(roundToNearestIncrement(144, "lbs")).toBe(145);
    });

    it("should round kg to nearest 1.25", () => {
      expect(roundToNearestIncrement(64, "kg")).toBe(63.75);
      expect(roundToNearestIncrement(65, "kg")).toBe(65);
      expect(roundToNearestIncrement(65.5, "kg")).toBe(65);
    });

    it("should handle exact multiples without change", () => {
      expect(roundToNearestIncrement(100, "lbs")).toBe(100);
      expect(roundToNearestIncrement(50, "kg")).toBe(50);
    });
  });

  // ---------------------------------------------------------------------------
  // buildSessionSnapshot
  // ---------------------------------------------------------------------------

  describe("buildSessionSnapshot", () => {
    it("should compute totalVolume as sum of reps*weight across valid sets", () => {
      const snapshot = buildSessionSnapshot(D1, [
        { reps: 10, weight: 100, rpe: 7, durationSeconds: null },
        { reps: 8, weight: 110, rpe: 8, durationSeconds: null },
      ]);
      expect(snapshot.totalVolume).toBe(10 * 100 + 8 * 110); // 1880
    });

    it("should find topSetWeight as the max weight", () => {
      const snapshot = buildSessionSnapshot(D1, [
        { reps: 10, weight: 100, rpe: 7, durationSeconds: null },
        { reps: 5, weight: 120, rpe: 9, durationSeconds: null },
        { reps: 8, weight: 110, rpe: 8, durationSeconds: null },
      ]);
      expect(snapshot.topSetWeight).toBe(120);
    });

    it("should find topSetReps as the max reps", () => {
      const snapshot = buildSessionSnapshot(D1, [
        { reps: 10, weight: 100, rpe: 7, durationSeconds: null },
        { reps: 5, weight: 120, rpe: 9, durationSeconds: null },
        { reps: 12, weight: 90, rpe: 6, durationSeconds: null },
      ]);
      expect(snapshot.topSetReps).toBe(12);
    });

    it("should compute averageRpe ignoring null RPE values", () => {
      const snapshot = buildSessionSnapshot(D1, [
        { reps: 10, weight: 100, rpe: 6, durationSeconds: null },
        { reps: 10, weight: 100, rpe: null, durationSeconds: null },
        { reps: 10, weight: 100, rpe: 8, durationSeconds: null },
      ]);
      expect(snapshot.averageRpe).toBe(7); // (6 + 8) / 2
    });

    it("should return averageRpe as null when no sets have RPE", () => {
      const snapshot = buildSessionSnapshot(D1, [
        { reps: 10, weight: 100, rpe: null, durationSeconds: null },
        { reps: 8, weight: 100, rpe: null, durationSeconds: null },
      ]);
      expect(snapshot.averageRpe).toBeNull();
    });

    it("should filter out sets with null reps or weight", () => {
      const snapshot = buildSessionSnapshot(D1, [
        { reps: 10, weight: 100, rpe: 7, durationSeconds: null },
        { reps: null as unknown as number, weight: 100, rpe: 7, durationSeconds: null },
        { reps: 8, weight: null as unknown as number, rpe: 7, durationSeconds: null },
      ]);
      expect(snapshot.numberOfSets).toBe(1);
      expect(snapshot.totalVolume).toBe(1000);
    });

    it("should handle empty sets array", () => {
      const snapshot = buildSessionSnapshot(D1, []);
      expect(snapshot.totalVolume).toBe(0);
      expect(snapshot.topSetWeight).toBe(0);
      expect(snapshot.topSetReps).toBe(0);
      expect(snapshot.averageRpe).toBeNull();
      expect(snapshot.numberOfSets).toBe(0);
      expect(snapshot.sets).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // detectTrend
  // ---------------------------------------------------------------------------

  describe("detectTrend", () => {
    it("should return 'improving' when volume increased in 2 of 3 recent sessions", () => {
      const sessions = [
        makeSession(D1, [{ reps: 10, weight: 100 }]), // vol 1000
        makeSession(D2, [{ reps: 10, weight: 110 }]), // vol 1100 (+10%)
        makeSession(D3, [{ reps: 10, weight: 120 }]), // vol 1200 (+9%)
        makeSession(D4, [{ reps: 10, weight: 130 }]), // vol 1300 (+8%)
      ];
      const { trendStatus } = detectTrend(sessions, 3);
      expect(trendStatus).toBe("improving");
    });

    it("should return 'improving' when top-set weight increased in 2 of 3 recent sessions", () => {
      // Same volume, but weight keeps going up with fewer reps
      const sessions = [
        makeSession(D1, [{ reps: 10, weight: 100 }]),
        makeSession(D2, [{ reps: 8, weight: 125 }]),
        makeSession(D3, [{ reps: 7, weight: 142 }]),
        makeSession(D4, [{ reps: 6, weight: 158 }]),
      ];
      const { trendStatus } = detectTrend(sessions, 3);
      expect(trendStatus).toBe("improving");
    });

    it("should return 'plateau' when volume is flat for plateauThreshold sessions", () => {
      const sessions = [
        makeSession(D1, [{ reps: 10, weight: 100 }]), // vol 1000
        makeSession(D2, [{ reps: 10, weight: 100 }]), // vol 1000
        makeSession(D3, [{ reps: 10, weight: 100 }]), // vol 1000
        makeSession(D4, [{ reps: 10, weight: 100 }]), // vol 1000
      ];
      const { trendStatus } = detectTrend(sessions, 3);
      expect(trendStatus).toBe("plateau");
    });

    it("should return 'plateau' with correct plateauCount", () => {
      const sessions = [
        makeSession(D1, [{ reps: 10, weight: 100 }]), // vol 1000
        makeSession(D2, [{ reps: 10, weight: 100 }]), // vol 1000
        makeSession(D3, [{ reps: 10, weight: 100 }]), // vol 1000
        makeSession(D4, [{ reps: 10, weight: 100 }]), // vol 1000
        makeSession(D5, [{ reps: 10, weight: 100 }]), // vol 1000
      ];
      const { plateauCount } = detectTrend(sessions, 3);
      // 4 consecutive flat pairs (D1-D2, D2-D3, D3-D4, D4-D5)
      expect(plateauCount).toBe(4);
    });

    it("should return 'declining' when volume decreased in 2 of 3 recent sessions", () => {
      const sessions = [
        makeSession(D1, [{ reps: 10, weight: 130 }]), // vol 1300
        makeSession(D2, [{ reps: 10, weight: 120 }]), // vol 1200 (-8%)
        makeSession(D3, [{ reps: 10, weight: 110 }]), // vol 1100 (-8%)
        makeSession(D4, [{ reps: 10, weight: 100 }]), // vol 1000 (-9%)
      ];
      const { trendStatus } = detectTrend(sessions, 3);
      expect(trendStatus).toBe("declining");
    });

    it("should return 'declining' when average RPE > 8 for 3+ consecutive sessions", () => {
      const sessions = [
        makeSession(D1, [{ reps: 10, weight: 100, rpe: 9, durationSeconds: null }]),
        makeSession(D2, [{ reps: 10, weight: 100, rpe: 9, durationSeconds: null }]),
        makeSession(D3, [{ reps: 10, weight: 100, rpe: 9, durationSeconds: null }]),
        makeSession(D4, [{ reps: 10, weight: 100, rpe: 9, durationSeconds: null }]),
      ];
      const { trendStatus } = detectTrend(sessions, 3);
      expect(trendStatus).toBe("declining");
    });

    it("should handle exactly 2 sessions", () => {
      const sessions = [
        makeSession(D1, [{ reps: 10, weight: 100 }]),
        makeSession(D2, [{ reps: 10, weight: 110 }]),
      ];
      const { trendStatus } = detectTrend(sessions, 3);
      expect(trendStatus).toBe("improving");
    });

    it("should use the configured plateauThreshold (not hardcoded)", () => {
      // With threshold=2, only 2 consecutive flat sessions needed -> plateau
      const sessions = [
        makeSession(D1, [{ reps: 10, weight: 100 }]),
        makeSession(D2, [{ reps: 10, weight: 100 }]),
        makeSession(D3, [{ reps: 10, weight: 100 }]),
      ];
      const { trendStatus: t2 } = detectTrend(sessions, 2);
      expect(t2).toBe("plateau");

      // With threshold=4, 3 flat sessions not enough yet
      const { trendStatus: t4 } = detectTrend(sessions, 4);
      expect(t4).not.toBe("plateau");
    });

    it("should treat +/- 2.5% volume change as flat", () => {
      // 1000 -> 1024 is +2.4%, within band -> flat
      const sessions = [
        makeSession(D1, [{ reps: 10, weight: 100 }]), // 1000
        makeSession(D2, [{ reps: 10, weight: 102 }]), // 1020 (+2%)
        makeSession(D3, [{ reps: 10, weight: 104 }]), // 1040 (+1.96%)
        makeSession(D4, [{ reps: 10, weight: 102 }]), // 1020 (-1.9%)
      ];
      // Volume changes all within 2.5% -> plateau
      const { trendStatus } = detectTrend(sessions, 3);
      expect(trendStatus).toBe("plateau");
    });

    it("should count plateau from most recent session backward", () => {
      // First session improved, then 4 flat sessions
      const sessions = [
        makeSession(D1, [{ reps: 10, weight: 80 }]),  // 800
        makeSession(D2, [{ reps: 10, weight: 100 }]), // 1000 (big jump)
        makeSession(D3, [{ reps: 10, weight: 100 }]), // 1000 flat
        makeSession(D4, [{ reps: 10, weight: 100 }]), // 1000 flat
        makeSession(D5, [{ reps: 10, weight: 100 }]), // 1000 flat
      ];
      const { plateauCount } = detectTrend(sessions, 3);
      // Flat pairs: D2-D3, D3-D4, D4-D5 = 3 consecutive flat pairs
      expect(plateauCount).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // generateSuggestion
  // ---------------------------------------------------------------------------

  describe("generateSuggestion", () => {
    it("should suggest weight increase when improving", () => {
      const session = makeSession(D1, [
        { reps: 8, weight: 135, rpe: 7, durationSeconds: null },
        { reps: 8, weight: 135, rpe: 7, durationSeconds: null },
        { reps: 8, weight: 135, rpe: 8, durationSeconds: null },
      ]);
      const suggestion = generateSuggestion("improving", 0, session, "lbs");
      expect(suggestion).not.toBeNull();
      expect(suggestion!.type).toBe("increase_weight");
    });

    it("should round weight suggestion to nearest 2.5 lbs", () => {
      // 135 * 1.05 = 141.75 -> rounds to 142.5
      const session = makeSession(D1, [{ reps: 8, weight: 135 }]);
      const suggestion = generateSuggestion("improving", 0, session, "lbs");
      expect(suggestion!.details.suggestedValue).toBe(142.5);
    });

    it("should round weight suggestion to nearest 1.25 kg", () => {
      // 60 * 1.05 = 63, and 63 / 1.25 = 50.4 -> rounds down to 50 -> 50 * 1.25 = 62.5
      const session = makeSession(D1, [{ reps: 8, weight: 60 }]);
      const suggestion = generateSuggestion("improving", 0, session, "kg");
      expect(suggestion!.details.suggestedValue).toBe(62.5);
      // Verify it IS a multiple of 1.25
      expect(suggestion!.details.suggestedValue % 1.25).toBeCloseTo(0);
    });

    it("should suggest rep increase when improving and reps <= 3", () => {
      const session = makeSession(D1, [
        { reps: 3, weight: 300, rpe: 9, durationSeconds: null },
        { reps: 2, weight: 310, rpe: 9, durationSeconds: null },
      ]);
      const suggestion = generateSuggestion("improving", 0, session, "lbs");
      expect(suggestion!.type).toBe("increase_reps");
    });

    it("should suggest adding a set when plateaued with low plateauCount", () => {
      const session = makeSession(D1, [
        { reps: 10, weight: 100 },
        { reps: 10, weight: 100 },
        { reps: 10, weight: 100 },
      ]);
      const suggestion = generateSuggestion("plateau", 2, session, "lbs");
      expect(suggestion!.type).toBe("add_set");
    });

    it("should not suggest adding a set beyond 6 sets", () => {
      // 6 sets already -> can't add more
      const session = makeSession(D1, [
        { reps: 10, weight: 100 },
        { reps: 10, weight: 100 },
        { reps: 10, weight: 100 },
        { reps: 10, weight: 100 },
        { reps: 10, weight: 100 },
        { reps: 10, weight: 100 },
      ]);
      const suggestion = generateSuggestion("plateau", 2, session, "lbs");
      // At 6 sets, must suggest something other than add_set
      expect(suggestion!.type).not.toBe("add_set");
    });

    it("should suggest deload when plateaued for 4+ sessions", () => {
      const session = makeSession(D1, [{ reps: 10, weight: 100 }]);
      const suggestion = generateSuggestion("plateau", 4, session, "lbs");
      expect(suggestion!.type).toBe("deload");
    });

    it("should suggest maintaining when declining with high RPE", () => {
      const session = makeSession(D1, [
        { reps: 10, weight: 100, rpe: 9, durationSeconds: null },
        { reps: 10, weight: 100, rpe: 9, durationSeconds: null },
      ]);
      const suggestion = generateSuggestion("declining", 0, session, "lbs");
      expect(suggestion!.type).toBe("maintain");
    });

    it("should suggest maintaining when declining without high RPE", () => {
      const session = makeSession(D1, [
        { reps: 10, weight: 100, rpe: 6, durationSeconds: null },
        { reps: 10, weight: 100, rpe: 6, durationSeconds: null },
      ]);
      const suggestion = generateSuggestion("declining", 0, session, "lbs");
      expect(suggestion!.type).toBe("maintain");
    });

    it("should return a human-readable message string", () => {
      const session = makeSession(D1, [{ reps: 8, weight: 135 }]);
      const suggestion = generateSuggestion("improving", 0, session, "lbs");
      expect(typeof suggestion!.message).toBe("string");
      expect(suggestion!.message.length).toBeGreaterThan(10);
      // Should mention a specific weight
      expect(suggestion!.message).toMatch(/\d/);
    });
  });

  // ---------------------------------------------------------------------------
  // analyzeProgressiveOverload
  // ---------------------------------------------------------------------------

  describe("analyzeProgressiveOverload", () => {
    it("should return null suggestion with fewer than 2 sessions", () => {
      const sessions = [makeSession(D1, [{ reps: 10, weight: 100 }])];
      const result = analyzeProgressiveOverload(sessions, {
        plateauThreshold: 3,
        weightUnit: "lbs",
      });
      expect(result.suggestion).toBeNull();
    });

    it("should return 'improving' default status with fewer than 2 sessions", () => {
      const result = analyzeProgressiveOverload([], {
        plateauThreshold: 3,
        weightUnit: "lbs",
      });
      expect(result.trendStatus).toBe("improving");
      expect(result.plateauCount).toBe(0);
    });

    it("should combine trend detection and suggestion generation", () => {
      const sessions = [
        makeSession(D1, [{ reps: 10, weight: 100 }]),
        makeSession(D2, [{ reps: 10, weight: 110 }]),
        makeSession(D3, [{ reps: 10, weight: 120 }]),
        makeSession(D4, [{ reps: 10, weight: 130 }]),
      ];
      const result = analyzeProgressiveOverload(sessions, {
        plateauThreshold: 3,
        weightUnit: "lbs",
      });
      expect(result.trendStatus).toBe("improving");
      expect(result.suggestion).not.toBeNull();
      expect(result.suggestion!.type).toBe("increase_weight");
    });

    it("should pass plateauThreshold from config to detectTrend", () => {
      const sessions = [
        makeSession(D1, [{ reps: 10, weight: 100 }]),
        makeSession(D2, [{ reps: 10, weight: 100 }]),
        makeSession(D3, [{ reps: 10, weight: 100 }]),
      ];
      const result2 = analyzeProgressiveOverload(sessions, {
        plateauThreshold: 2,
        weightUnit: "lbs",
      });
      expect(result2.trendStatus).toBe("plateau");

      const result4 = analyzeProgressiveOverload(sessions, {
        plateauThreshold: 4,
        weightUnit: "lbs",
      });
      expect(result4.trendStatus).not.toBe("plateau");
    });

    it("scenario: 3 sessions of increasing bench press weight -> improving + weight increase suggestion", () => {
      const sessions = [
        makeSession(D1, [
          { reps: 5, weight: 135, rpe: 7, durationSeconds: null },
          { reps: 5, weight: 135, rpe: 8, durationSeconds: null },
          { reps: 5, weight: 135, rpe: 8, durationSeconds: null },
        ]),
        makeSession(D2, [
          { reps: 5, weight: 145, rpe: 7, durationSeconds: null },
          { reps: 5, weight: 145, rpe: 8, durationSeconds: null },
          { reps: 5, weight: 145, rpe: 8, durationSeconds: null },
        ]),
        makeSession(D3, [
          { reps: 5, weight: 155, rpe: 7, durationSeconds: null },
          { reps: 5, weight: 155, rpe: 8, durationSeconds: null },
          { reps: 5, weight: 155, rpe: 8, durationSeconds: null },
        ]),
      ];
      const result = analyzeProgressiveOverload(sessions, {
        plateauThreshold: 3,
        weightUnit: "lbs",
      });
      expect(result.trendStatus).toBe("improving");
      expect(result.suggestion!.type).toBe("increase_weight");
      // 155 * 1.05 = 162.75 -> rounds to 162.5
      expect(result.suggestion!.details.suggestedValue).toBe(162.5);
    });

    it("scenario: 4 sessions of flat squat volume -> plateau + add set suggestion", () => {
      const sessions = [
        makeSession(D1, [{ reps: 5, weight: 225 }, { reps: 5, weight: 225 }, { reps: 5, weight: 225 }]),
        makeSession(D2, [{ reps: 5, weight: 225 }, { reps: 5, weight: 225 }, { reps: 5, weight: 225 }]),
        makeSession(D3, [{ reps: 5, weight: 225 }, { reps: 5, weight: 225 }, { reps: 5, weight: 225 }]),
        makeSession(D4, [{ reps: 5, weight: 225 }, { reps: 5, weight: 225 }, { reps: 5, weight: 225 }]),
      ];
      const result = analyzeProgressiveOverload(sessions, {
        plateauThreshold: 3,
        weightUnit: "lbs",
      });
      expect(result.trendStatus).toBe("plateau");
      expect(result.plateauCount).toBe(3);
      expect(result.suggestion!.type).toBe("add_set");
    });

    it("scenario: 5 sessions of flat volume -> plateau + deload suggestion", () => {
      const sessions = [
        makeSession(D1, [{ reps: 5, weight: 225 }]),
        makeSession(D2, [{ reps: 5, weight: 225 }]),
        makeSession(D3, [{ reps: 5, weight: 225 }]),
        makeSession(D4, [{ reps: 5, weight: 225 }]),
        makeSession(D5, [{ reps: 5, weight: 225 }]),
      ];
      const result = analyzeProgressiveOverload(sessions, {
        plateauThreshold: 3,
        weightUnit: "lbs",
      });
      expect(result.trendStatus).toBe("plateau");
      expect(result.plateauCount).toBeGreaterThanOrEqual(4);
      expect(result.suggestion!.type).toBe("deload");
    });

    it("scenario: 3 sessions of declining volume with high RPE -> declining + maintain suggestion", () => {
      const sessions = [
        makeSession(D1, [{ reps: 10, weight: 130, rpe: 9, durationSeconds: null }]),
        makeSession(D2, [{ reps: 10, weight: 120, rpe: 9, durationSeconds: null }]),
        makeSession(D3, [{ reps: 10, weight: 110, rpe: 9, durationSeconds: null }]),
        makeSession(D4, [{ reps: 10, weight: 100, rpe: 9, durationSeconds: null }]),
      ];
      const result = analyzeProgressiveOverload(sessions, {
        plateauThreshold: 3,
        weightUnit: "lbs",
      });
      expect(result.trendStatus).toBe("declining");
      expect(result.suggestion!.type).toBe("maintain");
    });
  });
});
