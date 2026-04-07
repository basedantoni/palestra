import { describe, it, expect } from "vitest";
import { parseWorkoutMarkdown, inferWorkoutType } from "./workout-import-parser";
import * as fs from "fs";

// Helper to build a minimal markdown block for a single date
function md(dateStr: string, lines: string[]): string {
  return `**${dateStr}**\n${lines.join("\n")}\n`;
}

// ---- Date parsing ----

describe("parseWorkoutMarkdown - date parsing", () => {
  it("parses a date block and returns a workout at noon UTC", () => {
    const input = md("20260105", ["Plank 3 x 60s"]);
    const result = parseWorkoutMarkdown(input);
    expect(result.workouts).toHaveLength(1);
    const w = result.workouts[0]!;
    expect(w.date.getUTCFullYear()).toBe(2026);
    expect(w.date.getUTCMonth()).toBe(0); // January
    expect(w.date.getUTCDate()).toBe(5);
    expect(w.date.getUTCHours()).toBe(12);
  });

  it("parses multiple date blocks in order", () => {
    const input = [
      md("20260101", ["Plank 3 x 60s"]),
      md("20260102", ["Rest Day"]),
    ].join("\n");
    const result = parseWorkoutMarkdown(input);
    expect(result.workouts).toHaveLength(2);
    expect(result.workouts[0]!.date.getUTCDate()).toBe(1);
    expect(result.workouts[1]!.date.getUTCDate()).toBe(2);
  });

  it("handles the trailing ** ** date format (like 20260331)", () => {
    const input = "**20260331**  \nSkipped 👎** **\n\n**20260401**\nPlank 3 x 60s\n";
    const result = parseWorkoutMarkdown(input);
    // Should have at least 2 workouts
    expect(result.workouts.length).toBeGreaterThanOrEqual(2);
    const dates = result.workouts.map((w) => w.date.getUTCDate());
    expect(dates).toContain(31);
    expect(dates).toContain(1);
  });
});

// ---- Rest days ----

describe("parseWorkoutMarkdown - rest days", () => {
  it("marks 'Rest Day' as a rest day", () => {
    const input = md("20260107", ["Rest Day"]);
    const result = parseWorkoutMarkdown(input);
    expect(result.workouts[0]!.isRestDay).toBe(true);
    expect(result.workouts[0]!.exercises).toHaveLength(0);
  });

  it("marks 'Rest/Skip 👎' as a rest day", () => {
    const input = md("20260113", ["Rest/Skip 👎"]);
    const result = parseWorkoutMarkdown(input);
    expect(result.workouts[0]!.isRestDay).toBe(true);
  });

  it("marks 'Skipped 👎' as a rest day", () => {
    const input = md("20260308", ["Skipped 👎"]);
    const result = parseWorkoutMarkdown(input);
    expect(result.workouts[0]!.isRestDay).toBe(true);
  });

  it("marks 'Recovery focused' as a rest day", () => {
    const input = md("20260215", ["Recovery focused"]);
    const result = parseWorkoutMarkdown(input);
    expect(result.workouts[0]!.isRestDay).toBe(true);
  });

  it("marks 'Mobility' as a rest day", () => {
    const input = md("20260214", ["Mobility"]);
    const result = parseWorkoutMarkdown(input);
    expect(result.workouts[0]!.isRestDay).toBe(true);
  });

  it("marks 'Rest/Debauchery Day/Skip 👎' as a rest day", () => {
    const input = md("20260110", ["Rest/Debauchery Day/Skip 👎"]);
    const result = parseWorkoutMarkdown(input);
    expect(result.workouts[0]!.isRestDay).toBe(true);
  });

  it("marks 'Rest/Hangover Day/Skip 👎' as a rest day", () => {
    const input = md("20260111", ["Rest/Hangover Day/Skip 👎"]);
    const result = parseWorkoutMarkdown(input);
    expect(result.workouts[0]!.isRestDay).toBe(true);
  });

  it("marks 'Rest' as a rest day", () => {
    const input = md("20260314", ["Rest"]);
    const result = parseWorkoutMarkdown(input);
    expect(result.workouts[0]!.isRestDay).toBe(true);
  });
});

// ---- Standard exercises ----

describe("parseWorkoutMarkdown - standard exercises", () => {
  it("parses basic exercise: name, sets, reps, weight", () => {
    const input = md("20260101", ["Zercher Squats 2 x 5 @ 135lbs"]);
    const result = parseWorkoutMarkdown(input);
    const exercises = result.workouts[0]!.exercises;
    expect(exercises).toHaveLength(1);
    const ex = exercises[0]!;
    expect(ex.name).toBe("Zercher Squats");
    expect(ex.sets).toHaveLength(2);
    expect(ex.sets[0]!.setNumber).toBe(1);
    expect(ex.sets[0]!.reps).toBe(5);
    expect(ex.sets[0]!.weight).toBe(135);
    expect(ex.isSkipped).toBe(false);
  });

  it("parses exercise with no weight: Hamstring Stretch to Lunge Rock 3 x 10", () => {
    const input = md("20260101", ["Hamstring Stretch to Lunge Rock 3 x 10"]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.name).toBe("Hamstring Stretch to Lunge Rock");
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[0]!.reps).toBe(10);
    expect(ex.sets[0]!.weight).toBeUndefined();
  });

  it("parses bodyweight: Dips 3 x 8 @ BW", () => {
    const input = md("20260101", ["Dips 3 x 8 @ BW"]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.name).toBe("Dips");
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[0]!.reps).toBe(8);
    expect(ex.sets[0]!.weight).toBe(0);
    expect(ex.notes).toContain("Bodyweight");
  });

  it("parses timed exercise: Plank 3 x 60s", () => {
    const input = md("20260101", ["Plank 3 x 60s"]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.name).toBe("Plank");
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[0]!.durationSeconds).toBe(60);
    expect(ex.sets[0]!.reps).toBeUndefined();
  });

  it("parses timed exercise: Reverse Plank 3 x 30s", () => {
    const input = md("20260101", ["Reverse Plank 3 x 30s"]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[0]!.durationSeconds).toBe(30);
    expect(ex.sets[0]!.reps).toBeUndefined();
  });

  it("parses RPE: Zercher Squats 3 x 5 @ 165lbs rpe 9", () => {
    const input = md("20260101", ["Zercher Squats 3 x 5 @ 165lbs rpe 9"]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[0]!.rpe).toBe(9);
    expect(ex.sets[0]!.weight).toBe(165);
  });

  it("parses 'reps' suffix: RDL 3 x 7 reps @ 115lbs", () => {
    const input = md("20260101", ["RDL 3 x 7 reps @ 115lbs"]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.name).toBe("RDL");
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[0]!.reps).toBe(7);
    expect(ex.sets[0]!.weight).toBe(115);
  });

  it("parses exercise with decimal weight: Lat Pulldown 3 x 8 @ 137.5lbs", () => {
    const input = md("20260101", ["Lat Pulldown 3 x 8 @ 137.5lbs"]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.sets[0]!.weight).toBe(137.5);
  });
});

// ---- Strikethrough ----

describe("parseWorkoutMarkdown - strikethrough", () => {
  it("marks strikethrough exercise as isSkipped: true", () => {
    const input = md("20260126", ["~~Incline DB Y-Raise 2 x 12 @ 15lbs~~"]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.isSkipped).toBe(true);
    expect(ex.name).toBe("Incline DB Y-Raise");
    expect(ex.sets).toHaveLength(2);
  });

  it("still parses the exercise when strikethrough", () => {
    const input = md("20260306", [
      "~~Box Jumps 3 x 10 @ 24\"~~",
      "RDL 3 x 7 reps @ 155lbs",
    ]);
    const result = parseWorkoutMarkdown(input);
    const exercises = result.workouts[0]!.exercises;
    const boxJumps = exercises.find((e) => e.name.includes("Box Jumps"));
    expect(boxJumps?.isSkipped).toBe(true);
    const rdl = exercises.find((e) => e.name === "RDL");
    expect(rdl?.isSkipped).toBe(false);
  });

  it("excludes skipped exercises from uniqueExerciseNames", () => {
    const input = md("20260126", [
      "~~Incline DB Y-Raise 2 x 12 @ 15lbs~~",
      "Plank 3 x 60s",
    ]);
    const result = parseWorkoutMarkdown(input);
    expect(result.uniqueExerciseNames).not.toContain("Incline DB Y-Raise");
    expect(result.uniqueExerciseNames).toContain("Plank");
  });
});

// ---- EMOM ----

describe("parseWorkoutMarkdown - EMOM", () => {
  it("parses EMOM: 30 KB Swings EMOM x 5 @ 40lbs", () => {
    const input = md("20260112", ["30 KB Swings EMOM x 5 @ 40lbs"]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.name).toBe("KB Swings");
    expect(ex.rounds).toBe(5);
    expect(ex.sets).toHaveLength(5);
    expect(ex.sets[0]!.reps).toBe(30);
    expect(ex.sets[0]!.weight).toBe(40);
  });

  it("parses EMOM with different round count", () => {
    const input = md("20260228", ["30 KB Swings EMOM x 6 @ 35lbs"]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.rounds).toBe(6);
    expect(ex.sets).toHaveLength(6);
  });
});

// ---- Sub-bullets ----

describe("parseWorkoutMarkdown - sub-bullets", () => {
  it("treats sub-bullet without set pattern as notes on previous exercise", () => {
    const input = md("20260108", [
      "Assault Treadmill Sprints",
      "* 10 sets, 15s @ 80%, 45s off",
    ]);
    const result = parseWorkoutMarkdown(input);
    const exercises = result.workouts[0]!.exercises;
    expect(exercises).toHaveLength(1);
    const ex = exercises[0]!;
    expect(ex.name).toBe("Assault Treadmill Sprints");
    expect(ex.notes).toContain("10 sets, 15s @ 80%, 45s off");
  });

  it("treats sub-bullet with set pattern as a child exercise", () => {
    const input = md("20260114", [
      "Core Stability",
      "* Medicine Ball Around the World 3 x 8 @ 6lbs",
    ]);
    const result = parseWorkoutMarkdown(input);
    const exercises = result.workouts[0]!.exercises;
    expect(exercises).toHaveLength(2);
    expect(exercises[0]!.name).toBe("Core Stability");
    expect(exercises[1]!.name).toBe("Medicine Ball Around the World");
    expect(exercises[1]!.sets).toHaveLength(3);
    expect(exercises[1]!.sets[0]!.reps).toBe(8);
    expect(exercises[1]!.sets[0]!.weight).toBe(6);
  });

  it("handles multiple sub-bullets as notes", () => {
    const input = md("20260101", [
      "Assault Treadmill Sprints",
      "* 10 sets, 15s @ 80%, 45s off",
      "* some extra note",
    ]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.notes).toContain("10 sets, 15s @ 80%, 45s off");
    expect(ex.notes).toContain("some extra note");
  });

  it("handles multiple sub-bullets as child exercises", () => {
    const input = md("20260127", [
      "Core Stability",
      "* Medicine Ball Russian Twist 3 x 20 @ 10lbs",
      "* Medicine Ball Around the World 3 x 8 @ 10lbs",
    ]);
    const result = parseWorkoutMarkdown(input);
    const exercises = result.workouts[0]!.exercises;
    expect(exercises).toHaveLength(3);
    expect(exercises[1]!.name).toBe("Medicine Ball Russian Twist");
    expect(exercises[2]!.name).toBe("Medicine Ball Around the World");
  });
});

// ---- Per-set overrides ----

describe("parseWorkoutMarkdown - per-set overrides", () => {
  it("handles 'N on 3rd set' override: Incline Bench Press 3 x 8 @ 135lbs, 9 on 3rd set", () => {
    const input = md("20260106", [
      "Incline Bench Press 3 x 8 @ 135lbs, 9 on 3rd set",
    ]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[0]!.reps).toBe(8);
    expect(ex.sets[1]!.reps).toBe(8);
    expect(ex.sets[2]!.reps).toBe(9);
  });

  it("handles 'last set N' override: Lat Pulldown 3 x 8 @ 137.5lbs rpe 9, last set 10", () => {
    const input = md("20260303", [
      "Lat Pulldown 3 x 8 @ 137.5lbs rpe 9, last set 10",
    ]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[0]!.reps).toBe(8);
    expect(ex.sets[1]!.reps).toBe(8);
    expect(ex.sets[2]!.reps).toBe(10);
    expect(ex.sets[0]!.rpe).toBe(9);
  });

  it("handles 'N reps last set*' override: Dips Machine 3 x 8 @ 198lbs, 12 reps last set*", () => {
    const input = md("20260116", [
      "Dips Machine 3 x 8 @ 198lbs, 12 reps last set*",
    ]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[2]!.reps).toBe(12);
    expect(ex.sets[0]!.reps).toBe(8);
  });

  it("handles 'N on last set' override: Incline Bench Press 3 x 8 @ 145lbs, 7 on last set", () => {
    const input = md("20260121", [
      "Incline Bench Press 3 x 8 @ 145lbs, 7 on last set",
    ]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[2]!.reps).toBe(7);
  });

  it("handles 'last set N' in Dips Machine: 3 x 9 @ 180lbs, last set 10", () => {
    const input = md("20260312", [
      "Dips Machine 3 x 9 @ 180lbs, last set 10",
    ]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[0]!.reps).toBe(9);
    expect(ex.sets[2]!.reps).toBe(10);
  });
});

// ---- Multi-group sets ----

describe("parseWorkoutMarkdown - multi-group sets", () => {
  it("parses 'Pendlay Row 2 x 8, 1 x 10 @ 105lbs' as 3 total sets", () => {
    const input = md("20260304", ["Pendlay Row 2 x 8, 1 x 10 @ 105lbs"]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.name).toBe("Pendlay Row");
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[0]!.reps).toBe(8);
    expect(ex.sets[1]!.reps).toBe(8);
    expect(ex.sets[2]!.reps).toBe(10);
    expect(ex.sets[0]!.weight).toBe(105);
    expect(ex.sets[2]!.weight).toBe(105);
  });

  it("parses 'Machine Bulgarian Split 2 x 7, 1 x 8 reps @ 90lbs'", () => {
    const input = md("20260318", [
      "Machine Bulgarian Split 2 x 7, 1 x 8 reps @ 90lbs",
    ]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[0]!.reps).toBe(7);
    expect(ex.sets[2]!.reps).toBe(8);
  });
});

// ---- Special weight formats ----

describe("parseWorkoutMarkdown - special weight formats", () => {
  it("parses 'w/' weight: Russian Twist 3 x 60 w/ 8lb medicine ball", () => {
    const input = md("20260112", [
      "Russian Twist 3 x 60 w/ 8lb medicine ball",
    ]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.name).toBe("Russian Twist");
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[0]!.reps).toBe(60);
    expect(ex.sets[0]!.weight).toBe(8);
    expect(ex.notes).toContain("medicine ball");
  });

  it("parses height notation: Box Jumps 3 x 10 @ 24\"", () => {
    const input = md("20260108", ['Box Jumps 3 x 10 @ 24"']);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.name).toBe("Box Jumps");
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[0]!.weight).toBeUndefined();
    expect(ex.notes).toContain('24"');
  });

  it("parses '+ suffix': Zercher Squats 2 x 5 @ 135lbs + Vertical Jumps", () => {
    const input = md("20260105", [
      "Zercher Squats 2 x 5 @ 135lbs + Vertical Jumps",
    ]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.name).toBe("Zercher Squats");
    expect(ex.sets).toHaveLength(2);
    expect(ex.notes).toContain("Vertical Jumps");
    // Should NOT create a separate exercise for Vertical Jumps
    expect(result.workouts[0]!.exercises).toHaveLength(1);
  });
});

// ---- Cardio / free-text exercises ----

describe("parseWorkoutMarkdown - cardio / free-text", () => {
  it("parses 'Stair master' as free-text (no sets)", () => {
    const input = md("20260313", ["Stair master"]);
    const result = parseWorkoutMarkdown(input);
    const ex = result.workouts[0]!.exercises[0]!;
    expect(ex.sets).toHaveLength(0);
    expect(ex.name).toContain("Stair master");
  });

  it("parses 'Norwegian 4x4...' as exercise with notes", () => {
    const input = md("20260114", [
      "Norwegian 4x4 - Treadmill Run - 4mins @ 12:00 pace, 3 mins @ Recovery pace",
    ]);
    const result = parseWorkoutMarkdown(input);
    const exercises = result.workouts[0]!.exercises;
    // Should have the Norwegian 4x4 as an exercise (possibly with notes)
    expect(exercises.length).toBeGreaterThanOrEqual(1);
    const cardioEx = exercises[0]!;
    expect(cardioEx.name).toContain("Norwegian");
  });

  it("parses '9 holes @ Hancock +13' as free-text", () => {
    const input = md("20260305", ["9 holes @ Hancock +13"]);
    const result = parseWorkoutMarkdown(input);
    const exercises = result.workouts[0]!.exercises;
    expect(exercises.length).toBeGreaterThanOrEqual(1);
    // Exercise name should include "holes" or "Hancock"
    const ex = exercises[0]!;
    expect(ex.sets).toHaveLength(0);
  });
});

// ---- uniqueExerciseNames ----

describe("parseWorkoutMarkdown - uniqueExerciseNames", () => {
  it("deduplicates exercise names across workouts", () => {
    const input = [
      md("20260101", ["Plank 3 x 60s"]),
      md("20260102", ["Plank 3 x 60s"]),
    ].join("\n");
    const result = parseWorkoutMarkdown(input);
    expect(result.uniqueExerciseNames.filter((n) => n === "Plank")).toHaveLength(1);
  });

  it("excludes rest day workouts", () => {
    const input = [
      md("20260101", ["Rest Day"]),
      md("20260102", ["Plank 3 x 60s"]),
    ].join("\n");
    const result = parseWorkoutMarkdown(input);
    expect(result.uniqueExerciseNames).toContain("Plank");
    expect(result.uniqueExerciseNames).not.toContain("Rest Day");
  });

  it("excludes skipped exercises", () => {
    const input = md("20260126", [
      "~~Incline DB Y-Raise 2 x 12 @ 15lbs~~",
      "Back Extensions 2 x 15 @ BW",
    ]);
    const result = parseWorkoutMarkdown(input);
    expect(result.uniqueExerciseNames).not.toContain("Incline DB Y-Raise");
    expect(result.uniqueExerciseNames).toContain("Back Extensions");
  });

  it("is sorted alphabetically", () => {
    const input = [
      md("20260101", ["Zercher Squats 3 x 5 @ 135lbs"]),
      md("20260102", ["Lat Pulldown 3 x 8 @ 130lbs"]),
    ].join("\n");
    const result = parseWorkoutMarkdown(input);
    const names = result.uniqueExerciseNames;
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});

// ---- Full file parse ----

describe("parseWorkoutMarkdown - full file", () => {
  const filePath =
    "/Users/anthony/Downloads/2026 Athletic & Bodybuilding Plan/2026 Athletic & Bodybuilding Plan.md";

  it("parses the actual markdown file and returns workouts", () => {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      // Skip if file not available in CI
      console.warn("Skipping full file test: file not found at", filePath);
      return;
    }

    const result = parseWorkoutMarkdown(content);

    // The file covers Jan 5, 2026 through Apr 4, 2026 = 90 days
    // There should be at least 80 workout blocks (some are rest days)
    expect(result.workouts.length).toBeGreaterThanOrEqual(80);

    // Should have rest days
    const restDays = result.workouts.filter((w) => w.isRestDay);
    expect(restDays.length).toBeGreaterThan(10);

    // Should have actual workouts
    const activeDays = result.workouts.filter((w) => !w.isRestDay);
    expect(activeDays.length).toBeGreaterThan(20);

    // Should have unique exercise names
    expect(result.uniqueExerciseNames.length).toBeGreaterThan(10);

    // All workouts should be in chronological order
    for (let i = 1; i < result.workouts.length; i++) {
      expect(result.workouts[i]!.date.getTime()).toBeGreaterThanOrEqual(
        result.workouts[i - 1]!.date.getTime(),
      );
    }

    // Spot check: Jan 5 workout has Zercher Squats
    const jan5 = result.workouts.find(
      (w) => w.date.getUTCMonth() === 0 && w.date.getUTCDate() === 5,
    );
    expect(jan5).toBeDefined();
    expect(jan5!.exercises.some((e) => e.name.includes("Zercher"))).toBe(true);

    // Spot check: Jan 7 is rest day
    const jan7 = result.workouts.find(
      (w) => w.date.getUTCMonth() === 0 && w.date.getUTCDate() === 7,
    );
    expect(jan7?.isRestDay).toBe(true);

    // Spot check: Mar 3 has Zercher Squats 3x5 @ 165lbs rpe 9
    const mar3 = result.workouts.find(
      (w) => w.date.getUTCMonth() === 2 && w.date.getUTCDate() === 3,
    );
    expect(mar3).toBeDefined();
    const zercher = mar3!.exercises.find((e) => e.name === "Zercher Squats");
    expect(zercher).toBeDefined();
    expect(zercher!.sets[0]!.weight).toBe(165);
    expect(zercher!.sets[0]!.rpe).toBe(9);

    // Spot check: uniqueExerciseNames does not include rest-day content
    expect(result.uniqueExerciseNames).not.toContain("Rest Day");
    expect(result.uniqueExerciseNames).not.toContain("Skipped");
  });
});

// ---- inferWorkoutType ----

describe("inferWorkoutType", () => {
  it("returns 'hiit' when EMOM exercises are present", () => {
    const result = parseWorkoutMarkdown(
      md("20260112", ["30 KB Swings EMOM x 5 @ 40lbs"]),
    );
    const type = inferWorkoutType(result.workouts[0]!.exercises);
    expect(type).toBe("hiit");
  });

  it("returns 'weightlifting' for standard weighted exercises", () => {
    const result = parseWorkoutMarkdown(
      md("20260101", [
        "Zercher Squats 3 x 5 @ 135lbs",
        "Lat Pulldown 3 x 8 @ 130lbs",
      ]),
    );
    const type = inferWorkoutType(result.workouts[0]!.exercises);
    expect(type).toBe("weightlifting");
  });

  it("returns 'weightlifting' by default for empty exercises", () => {
    const type = inferWorkoutType([]);
    expect(type).toBe("weightlifting");
  });
});
