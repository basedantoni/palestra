import { describe, it, expect } from "vitest";
import {
  aggregateVolumeByWeek,
  aggregateVolumeByMonth,
  calculateStreaks,
  buildFrequencyMap,
  groupPersonalRecordsByExercise,
} from "./analytics-queries";

// ---------------------------------------------------------------------------
// aggregateVolumeByWeek
// ---------------------------------------------------------------------------

describe("aggregateVolumeByWeek", () => {
  it("returns empty array for empty input", () => {
    expect(aggregateVolumeByWeek([])).toEqual([]);
  });

  it("groups workouts into ISO weeks — 3 workouts across 2 weeks returns 2 data points", () => {
    const workouts = [
      { date: new Date("2026-02-23"), totalVolume: 1000 }, // Week 9
      { date: new Date("2026-02-25"), totalVolume: 500 },  // Week 9
      { date: new Date("2026-03-02"), totalVolume: 800 },  // Week 10
    ];
    const result = aggregateVolumeByWeek(workouts);
    expect(result).toHaveLength(2);
  });

  it("sums totalVolume within a week — 2 workouts in same week with volumes 1000 and 1500 returns 2500", () => {
    const workouts = [
      { date: new Date("2026-02-23"), totalVolume: 1000 },
      { date: new Date("2026-02-25"), totalVolume: 1500 },
    ];
    const result = aggregateVolumeByWeek(workouts);
    expect(result).toHaveLength(1);
    expect(result[0]!.totalVolume).toBe(2500);
    expect(result[0]!.workoutCount).toBe(2);
  });

  it("skips workouts with null totalVolume — counts them in workoutCount but does not add to totalVolume", () => {
    const workouts = [
      { date: new Date("2026-02-23"), totalVolume: 1000 },
      { date: new Date("2026-02-24"), totalVolume: null },
    ];
    const result = aggregateVolumeByWeek(workouts);
    expect(result).toHaveLength(1);
    expect(result[0]!.totalVolume).toBe(1000);
    expect(result[0]!.workoutCount).toBe(2);
  });

  it("sorts output chronologically — older weeks first", () => {
    const workouts = [
      { date: new Date("2026-03-02"), totalVolume: 800 }, // Week 10
      { date: new Date("2026-02-23"), totalVolume: 1000 }, // Week 9
      { date: new Date("2026-02-09"), totalVolume: 700 },  // Week 7
    ];
    const result = aggregateVolumeByWeek(workouts);
    expect(result[0]!.period).toBe("2026-W07");
    expect(result[1]!.period).toBe("2026-W09");
    expect(result[2]!.period).toBe("2026-W10");
  });

  it("formats period as ISO week string — e.g., '2026-W09'", () => {
    const workouts = [
      { date: new Date("2026-02-23"), totalVolume: 1000 }, // Week 9 of 2026
    ];
    const result = aggregateVolumeByWeek(workouts);
    expect(result[0]!.period).toBe("2026-W09");
  });
});

// ---------------------------------------------------------------------------
// aggregateVolumeByMonth
// ---------------------------------------------------------------------------

describe("aggregateVolumeByMonth", () => {
  it("returns empty array for empty input", () => {
    expect(aggregateVolumeByMonth([])).toEqual([]);
  });

  it("groups workouts into calendar months — workouts in Jan and Feb return 2 data points", () => {
    const workouts = [
      { date: new Date("2026-01-10"), totalVolume: 1000 },
      { date: new Date("2026-01-20"), totalVolume: 900 },
      { date: new Date("2026-02-05"), totalVolume: 800 },
    ];
    const result = aggregateVolumeByMonth(workouts);
    expect(result).toHaveLength(2);
  });

  it("sums totalVolume within a month", () => {
    const workouts = [
      { date: new Date("2026-01-10"), totalVolume: 1000 },
      { date: new Date("2026-01-20"), totalVolume: 900 },
    ];
    const result = aggregateVolumeByMonth(workouts);
    expect(result).toHaveLength(1);
    expect(result[0]!.totalVolume).toBe(1900);
    expect(result[0]!.workoutCount).toBe(2);
  });

  it("formats period as 'YYYY-MM' — e.g., '2026-03'", () => {
    const workouts = [
      { date: new Date("2026-03-04"), totalVolume: 1000 },
    ];
    const result = aggregateVolumeByMonth(workouts);
    expect(result[0]!.period).toBe("2026-03");
  });

  it("sorts output chronologically", () => {
    const workouts = [
      { date: new Date("2026-03-04"), totalVolume: 1000 },
      { date: new Date("2026-01-10"), totalVolume: 800 },
      { date: new Date("2026-02-15"), totalVolume: 600 },
    ];
    const result = aggregateVolumeByMonth(workouts);
    expect(result[0]!.period).toBe("2026-01");
    expect(result[1]!.period).toBe("2026-02");
    expect(result[2]!.period).toBe("2026-03");
  });
});

// ---------------------------------------------------------------------------
// calculateStreaks
// ---------------------------------------------------------------------------

describe("calculateStreaks", () => {
  it("returns zeros for empty input", () => {
    const result = calculateStreaks([], "2026-03-04");
    expect(result).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      lastWorkoutDate: null,
    });
  });

  it("single workout today returns streak of 1", () => {
    const result = calculateStreaks(["2026-03-04"], "2026-03-04");
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(1);
    expect(result.lastWorkoutDate).toBe("2026-03-04");
  });

  it("consecutive days returns correct current streak — workouts on Mon, Tue, Wed with today=Wed returns currentStreak=3", () => {
    // Mon=Mar 2, Tue=Mar 3, Wed=Mar 4
    const result = calculateStreaks(
      ["2026-03-02", "2026-03-03", "2026-03-04"],
      "2026-03-04",
    );
    expect(result.currentStreak).toBe(3);
  });

  it("gap breaks current streak — workouts on Mon, Wed with today=Wed returns currentStreak=1", () => {
    const result = calculateStreaks(
      ["2026-03-02", "2026-03-04"],
      "2026-03-04",
    );
    expect(result.currentStreak).toBe(1);
  });

  it("yesterday counts as continuing the streak — workouts Mon, Tue, Wed with today=Thu returns currentStreak=3", () => {
    const result = calculateStreaks(
      ["2026-03-02", "2026-03-03", "2026-03-04"],
      "2026-03-05",
    );
    expect(result.currentStreak).toBe(3);
  });

  it("two days ago breaks current streak — workouts Mon, Tue with today=Thu returns currentStreak=0", () => {
    const result = calculateStreaks(
      ["2026-03-02", "2026-03-03"],
      "2026-03-05",
    );
    expect(result.currentStreak).toBe(0);
  });

  it("longest streak is tracked separately — 5-day streak in January, 2-day current streak returns longestStreak=5, currentStreak=2", () => {
    const dates = [
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
      "2026-01-09",
      // gap
      "2026-03-03",
      "2026-03-04",
    ];
    const result = calculateStreaks(dates, "2026-03-04");
    expect(result.longestStreak).toBe(5);
    expect(result.currentStreak).toBe(2);
  });

  it("multiple workouts on same day count as one day", () => {
    const result = calculateStreaks(
      ["2026-03-02", "2026-03-02", "2026-03-02"],
      "2026-03-02",
    );
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(1);
  });

  it("returns lastWorkoutDate — the most recent workout date", () => {
    const result = calculateStreaks(
      ["2026-03-01", "2026-03-03", "2026-03-04"],
      "2026-03-06",
    );
    expect(result.lastWorkoutDate).toBe("2026-03-04");
  });
});

// ---------------------------------------------------------------------------
// buildFrequencyMap
// ---------------------------------------------------------------------------

describe("buildFrequencyMap", () => {
  it("returns empty array for empty input", () => {
    expect(buildFrequencyMap([])).toEqual([]);
  });

  it("returns one entry per unique date", () => {
    const workouts = [
      { date: new Date("2026-03-01"), totalVolume: 1000, durationMinutes: 60 },
      { date: new Date("2026-03-02"), totalVolume: 900, durationMinutes: 45 },
      { date: new Date("2026-03-03"), totalVolume: 800, durationMinutes: 50 },
    ];
    const result = buildFrequencyMap(workouts);
    expect(result).toHaveLength(3);
  });

  it("aggregates multiple workouts on same date — sums volume, sums duration, increments count", () => {
    const workouts = [
      { date: new Date("2026-03-01"), totalVolume: 1000, durationMinutes: 60 },
      { date: new Date("2026-03-01"), totalVolume: 500, durationMinutes: 30 },
    ];
    const result = buildFrequencyMap(workouts);
    expect(result).toHaveLength(1);
    expect(result[0]!.workoutCount).toBe(2);
    expect(result[0]!.totalVolume).toBe(1500);
    expect(result[0]!.totalDurationMinutes).toBe(90);
  });

  it("handles null volume and duration gracefully", () => {
    const workouts = [
      { date: new Date("2026-03-01"), totalVolume: null, durationMinutes: null },
    ];
    const result = buildFrequencyMap(workouts);
    expect(result).toHaveLength(1);
    expect(result[0]!.workoutCount).toBe(1);
    expect(result[0]!.totalVolume).toBeNull();
    expect(result[0]!.totalDurationMinutes).toBeNull();
  });

  it("sorts output by date ascending", () => {
    const workouts = [
      { date: new Date("2026-03-03"), totalVolume: 800, durationMinutes: 50 },
      { date: new Date("2026-03-01"), totalVolume: 1000, durationMinutes: 60 },
      { date: new Date("2026-03-02"), totalVolume: 900, durationMinutes: 45 },
    ];
    const result = buildFrequencyMap(workouts);
    expect(result[0]!.date).toBe("2026-03-01");
    expect(result[1]!.date).toBe("2026-03-02");
    expect(result[2]!.date).toBe("2026-03-03");
  });
});

// ---------------------------------------------------------------------------
// groupPersonalRecordsByExercise
// ---------------------------------------------------------------------------

describe("groupPersonalRecordsByExercise", () => {
  const baseDate = new Date("2026-03-04");

  it("returns empty array for empty input", () => {
    expect(groupPersonalRecordsByExercise([])).toEqual([]);
  });

  it("groups records by exerciseId — 3 records for 2 exercises returns 2 groups", () => {
    const records = [
      {
        exerciseId: "ex-1",
        exerciseName: "Bench Press",
        recordType: "max_weight",
        value: 150,
        previousRecordValue: 140,
        dateAchieved: baseDate,
      },
      {
        exerciseId: "ex-1",
        exerciseName: "Bench Press",
        recordType: "max_reps",
        value: 12,
        previousRecordValue: null,
        dateAchieved: baseDate,
      },
      {
        exerciseId: "ex-2",
        exerciseName: "Squat",
        recordType: "max_weight",
        value: 225,
        previousRecordValue: 200,
        dateAchieved: baseDate,
      },
    ];
    const result = groupPersonalRecordsByExercise(records);
    expect(result).toHaveLength(2);
  });

  it("computes delta as value - previousRecordValue — value=150, prev=140 returns delta=10", () => {
    const records = [
      {
        exerciseId: "ex-1",
        exerciseName: "Bench Press",
        recordType: "max_weight",
        value: 150,
        previousRecordValue: 140,
        dateAchieved: baseDate,
      },
    ];
    const result = groupPersonalRecordsByExercise(records);
    expect(result[0]!.records[0]!.delta).toBe(10);
  });

  it("delta is null when previousRecordValue is null (first PR ever)", () => {
    const records = [
      {
        exerciseId: "ex-1",
        exerciseName: "Bench Press",
        recordType: "max_weight",
        value: 150,
        previousRecordValue: null,
        dateAchieved: baseDate,
      },
    ];
    const result = groupPersonalRecordsByExercise(records);
    expect(result[0]!.records[0]!.delta).toBeNull();
  });

  it("filters out records with null exerciseId", () => {
    const records = [
      {
        exerciseId: null,
        exerciseName: null,
        recordType: "max_weight",
        value: 150,
        previousRecordValue: null,
        dateAchieved: baseDate,
      },
      {
        exerciseId: "ex-1",
        exerciseName: "Bench Press",
        recordType: "max_weight",
        value: 150,
        previousRecordValue: null,
        dateAchieved: baseDate,
      },
    ];
    const result = groupPersonalRecordsByExercise(records);
    expect(result).toHaveLength(1);
    expect(result[0]!.exerciseId).toBe("ex-1");
  });

  it("uses exerciseName from the record", () => {
    const records = [
      {
        exerciseId: "ex-1",
        exerciseName: "Bench Press",
        recordType: "max_weight",
        value: 150,
        previousRecordValue: null,
        dateAchieved: baseDate,
      },
    ];
    const result = groupPersonalRecordsByExercise(records);
    expect(result[0]!.exerciseName).toBe("Bench Press");
  });

  it("sorts records within each exercise by dateAchieved descending (most recent first)", () => {
    const olderDate = new Date("2026-01-01");
    const newerDate = new Date("2026-03-04");
    const records = [
      {
        exerciseId: "ex-1",
        exerciseName: "Bench Press",
        recordType: "max_weight",
        value: 140,
        previousRecordValue: null,
        dateAchieved: olderDate,
      },
      {
        exerciseId: "ex-1",
        exerciseName: "Bench Press",
        recordType: "max_reps",
        value: 12,
        previousRecordValue: null,
        dateAchieved: newerDate,
      },
    ];
    const result = groupPersonalRecordsByExercise(records);
    expect(result[0]!.records[0]!.dateAchieved).toEqual(newerDate);
    expect(result[0]!.records[1]!.dateAchieved).toEqual(olderDate);
  });
});
