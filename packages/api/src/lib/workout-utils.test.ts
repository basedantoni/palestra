import { describe, it, expect } from "vitest";
import {
  calculateSetVolume,
  calculateExerciseVolume,
  calculateTotalVolume,
  createBlankSet,
  createBlankExercise,
  formDataToApiInput,
  apiWorkoutToFormData,
  templateToWorkoutFormData,
  formatVolume,
  formatDuration,
  WORKOUT_TYPE_LABELS,
  EXERCISE_CATEGORY_LABELS,
} from "./workout-utils";
import type {
  WorkoutSetFormData,
  WorkoutExerciseFormData,
  WorkoutFormData,
} from "./workout-utils";

describe("workout-utils", () => {
  describe("calculateSetVolume", () => {
    it("should calculate volume correctly with valid reps and weight", () => {
      const set: WorkoutSetFormData = {
        tempId: "test-1",
        setNumber: 1,
        reps: 10,
        weight: 135,
        rpe: 7,
      };
      expect(calculateSetVolume(set)).toBe(1350);
    });

    it("should return 0 when reps is undefined", () => {
      const set: WorkoutSetFormData = {
        tempId: "test-1",
        setNumber: 1,
        reps: undefined,
        weight: 135,
        rpe: 7,
      };
      expect(calculateSetVolume(set)).toBe(0);
    });

    it("should return 0 when weight is undefined", () => {
      const set: WorkoutSetFormData = {
        tempId: "test-1",
        setNumber: 1,
        reps: 10,
        weight: undefined,
        rpe: 7,
      };
      expect(calculateSetVolume(set)).toBe(0);
    });

    it("should return 0 when both reps and weight are undefined", () => {
      const set: WorkoutSetFormData = {
        tempId: "test-1",
        setNumber: 1,
        reps: undefined,
        weight: undefined,
        rpe: undefined,
      };
      expect(calculateSetVolume(set)).toBe(0);
    });

    it("should handle zero values correctly", () => {
      const set: WorkoutSetFormData = {
        tempId: "test-1",
        setNumber: 1,
        reps: 0,
        weight: 135,
        rpe: 7,
      };
      expect(calculateSetVolume(set)).toBe(0);
    });

    it("should handle decimal weights", () => {
      const set: WorkoutSetFormData = {
        tempId: "test-1",
        setNumber: 1,
        reps: 10,
        weight: 135.5,
        rpe: 7,
      };
      expect(calculateSetVolume(set)).toBe(1355);
    });
  });

  describe("calculateExerciseVolume", () => {
    it("should sum volume across multiple sets", () => {
      const exercise: WorkoutExerciseFormData = {
        tempId: "ex-1",
        exerciseId: "bench-press",
        exerciseName: "Bench Press",
        order: 0,
        sets: [
          {
            tempId: "set-1",
            setNumber: 1,
            reps: 10,
            weight: 135,
            rpe: 7,
          },
          {
            tempId: "set-2",
            setNumber: 2,
            reps: 10,
            weight: 135,
            rpe: 8,
          },
          {
            tempId: "set-3",
            setNumber: 3,
            reps: 8,
            weight: 135,
            rpe: 9,
          },
        ],
        rounds: undefined,
        workDurationSeconds: undefined,
        restDurationSeconds: undefined,
        intensity: undefined,
        distance: undefined,
        durationSeconds: undefined,
        pace: undefined,
        heartRate: undefined,
        durationMinutes: undefined,
        notes: "",
      };
      // (10 * 135) + (10 * 135) + (8 * 135) = 3780
      expect(calculateExerciseVolume(exercise)).toBe(3780);
    });

    it("should return 0 for exercise with no sets", () => {
      const exercise: WorkoutExerciseFormData = {
        tempId: "ex-1",
        exerciseId: "bench-press",
        exerciseName: "Bench Press",
        order: 0,
        sets: [],
        rounds: undefined,
        workDurationSeconds: undefined,
        restDurationSeconds: undefined,
        intensity: undefined,
        distance: undefined,
        durationSeconds: undefined,
        pace: undefined,
        heartRate: undefined,
        durationMinutes: undefined,
        notes: "",
      };
      expect(calculateExerciseVolume(exercise)).toBe(0);
    });

    it("should ignore sets with undefined values", () => {
      const exercise: WorkoutExerciseFormData = {
        tempId: "ex-1",
        exerciseId: "bench-press",
        exerciseName: "Bench Press",
        order: 0,
        sets: [
          {
            tempId: "set-1",
            setNumber: 1,
            reps: 10,
            weight: 135,
            rpe: 7,
          },
          {
            tempId: "set-2",
            setNumber: 2,
            reps: undefined,
            weight: 135,
            rpe: 8,
          },
        ],
        rounds: undefined,
        workDurationSeconds: undefined,
        restDurationSeconds: undefined,
        intensity: undefined,
        distance: undefined,
        durationSeconds: undefined,
        pace: undefined,
        heartRate: undefined,
        durationMinutes: undefined,
        notes: "",
      };
      expect(calculateExerciseVolume(exercise)).toBe(1350);
    });
  });

  describe("calculateTotalVolume", () => {
    it("should sum volume across multiple exercises", () => {
      const exercises: WorkoutExerciseFormData[] = [
        {
          tempId: "ex-1",
          exerciseId: "bench-press",
          exerciseName: "Bench Press",
          order: 0,
          sets: [
            {
              tempId: "set-1",
              setNumber: 1,
              reps: 10,
              weight: 135,
              rpe: 7,
            },
            {
              tempId: "set-2",
              setNumber: 2,
              reps: 10,
              weight: 135,
              rpe: 8,
            },
          ],
          rounds: undefined,
          workDurationSeconds: undefined,
          restDurationSeconds: undefined,
          intensity: undefined,
          distance: undefined,
          durationSeconds: undefined,
          pace: undefined,
          heartRate: undefined,
          durationMinutes: undefined,
          notes: "",
        },
        {
          tempId: "ex-2",
          exerciseId: "squat",
          exerciseName: "Squat",
          order: 1,
          sets: [
            {
              tempId: "set-3",
              setNumber: 1,
              reps: 5,
              weight: 225,
              rpe: 8,
            },
          ],
          rounds: undefined,
          workDurationSeconds: undefined,
          restDurationSeconds: undefined,
          intensity: undefined,
          distance: undefined,
          durationSeconds: undefined,
          pace: undefined,
          heartRate: undefined,
          durationMinutes: undefined,
          notes: "",
        },
      ];
      // (10 * 135) + (10 * 135) + (5 * 225) = 3825
      expect(calculateTotalVolume(exercises)).toBe(3825);
    });

    it("should return 0 for empty exercise list", () => {
      expect(calculateTotalVolume([])).toBe(0);
    });
  });

  describe("createBlankSet", () => {
    it("should create a blank set with correct set number", () => {
      const set = createBlankSet(3);
      expect(set.setNumber).toBe(3);
      expect(set.reps).toBeUndefined();
      expect(set.weight).toBeUndefined();
      expect(set.rpe).toBeUndefined();
      expect(set.tempId).toBeDefined();
      expect(typeof set.tempId).toBe("string");
    });

    it("should generate unique tempIds", () => {
      const set1 = createBlankSet(1);
      const set2 = createBlankSet(1);
      expect(set1.tempId).not.toBe(set2.tempId);
    });
  });

  describe("createBlankExercise", () => {
    it("should create a blank exercise with one blank set", () => {
      const exercise = createBlankExercise(0);
      expect(exercise.order).toBe(0);
      expect(exercise.exerciseId).toBeUndefined();
      expect(exercise.exerciseName).toBe("");
      expect(exercise.sets).toHaveLength(1);
      expect(exercise.sets[0]?.setNumber).toBe(1);
      expect(exercise.tempId).toBeDefined();
      expect(typeof exercise.tempId).toBe("string");
    });

    it("should generate unique tempIds", () => {
      const ex1 = createBlankExercise(0);
      const ex2 = createBlankExercise(0);
      expect(ex1.tempId).not.toBe(ex2.tempId);
    });

    it("should initialize all optional fields to undefined", () => {
      const exercise = createBlankExercise(0);
      expect(exercise.rounds).toBeUndefined();
      expect(exercise.workDurationSeconds).toBeUndefined();
      expect(exercise.restDurationSeconds).toBeUndefined();
      expect(exercise.intensity).toBeUndefined();
      expect(exercise.distance).toBeUndefined();
      expect(exercise.durationSeconds).toBeUndefined();
      expect(exercise.pace).toBeUndefined();
      expect(exercise.heartRate).toBeUndefined();
      expect(exercise.durationMinutes).toBeUndefined();
    });
  });

  describe("formDataToApiInput", () => {
    it("should convert form data to API input correctly", () => {
      const formData: WorkoutFormData = {
        workoutType: "weightlifting",
        exercises: [
          {
            tempId: "ex-1",
            exerciseId: "bench-press-id",
            exerciseName: "Bench Press",
            order: 0,
            sets: [
              {
                tempId: "set-1",
                setNumber: 1,
                reps: 10,
                weight: 135,
                rpe: 7,
              },
              {
                tempId: "set-2",
                setNumber: 2,
                reps: undefined,
                weight: undefined,
                rpe: undefined,
              },
            ],
            rounds: undefined,
            workDurationSeconds: undefined,
            restDurationSeconds: undefined,
            intensity: undefined,
            distance: undefined,
            durationSeconds: undefined,
            pace: undefined,
            heartRate: undefined,
            durationMinutes: undefined,
            notes: "Good form",
          },
        ],
        notes: "Morning workout",
        templateId: undefined,
      };

      const result = formDataToApiInput(formData);

      expect(result.workoutType).toBe("weightlifting");
      expect(result.notes).toBe("Morning workout");
      expect(result.totalVolume).toBe(1350);
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0]?.exerciseId).toBe("bench-press-id");
      expect(result.logs[0]?.exerciseName).toBe("Bench Press");
      expect(result.logs[0]?.order).toBe(0);
      expect(result.logs[0]?.notes).toBe("Good form");
      expect(result.logs[0]?.sets).toHaveLength(1); // Empty set filtered out
      expect(result.logs[0]?.sets[0]?.reps).toBe(10);
      expect(result.logs[0]?.sets[0]?.weight).toBe(135);
    });

    it("should filter out exercises with empty names", () => {
      const formData: WorkoutFormData = {
        workoutType: "weightlifting",
        exercises: [
          {
            tempId: "ex-1",
            exerciseId: "bench-press-id",
            exerciseName: "Bench Press",
            order: 0,
            sets: [
              {
                tempId: "set-1",
                setNumber: 1,
                reps: 10,
                weight: 135,
                rpe: 7,
              },
            ],
            rounds: undefined,
            workDurationSeconds: undefined,
            restDurationSeconds: undefined,
            intensity: undefined,
            distance: undefined,
            durationSeconds: undefined,
            pace: undefined,
            heartRate: undefined,
            durationMinutes: undefined,
            notes: "",
          },
          {
            tempId: "ex-2",
            exerciseId: undefined,
            exerciseName: "   ",
            order: 1,
            sets: [],
            rounds: undefined,
            workDurationSeconds: undefined,
            restDurationSeconds: undefined,
            intensity: undefined,
            distance: undefined,
            durationSeconds: undefined,
            pace: undefined,
            heartRate: undefined,
            durationMinutes: undefined,
            notes: "",
          },
        ],
        notes: "",
        templateId: undefined,
      };

      const result = formDataToApiInput(formData);
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0]?.exerciseName).toBe("Bench Press");
    });

    it("should filter out empty sets", () => {
      const formData: WorkoutFormData = {
        workoutType: "weightlifting",
        exercises: [
          {
            tempId: "ex-1",
            exerciseId: "bench-press-id",
            exerciseName: "Bench Press",
            order: 0,
            sets: [
              {
                tempId: "set-1",
                setNumber: 1,
                reps: 10,
                weight: 135,
                rpe: 7,
              },
              {
                tempId: "set-2",
                setNumber: 2,
                reps: undefined,
                weight: undefined,
                rpe: undefined,
              },
              {
                tempId: "set-3",
                setNumber: 3,
                reps: 8,
                weight: undefined,
                rpe: 8,
              },
            ],
            rounds: undefined,
            workDurationSeconds: undefined,
            restDurationSeconds: undefined,
            intensity: undefined,
            distance: undefined,
            durationSeconds: undefined,
            pace: undefined,
            heartRate: undefined,
            durationMinutes: undefined,
            notes: "",
          },
        ],
        notes: "",
        templateId: undefined,
      };

      const result = formDataToApiInput(formData);
      expect(result.logs[0]?.sets).toHaveLength(2); // Only sets with reps OR weight
    });

    it("should convert empty notes to undefined", () => {
      const formData: WorkoutFormData = {
        workoutType: "weightlifting",
        exercises: [
          {
            tempId: "ex-1",
            exerciseId: "bench-press-id",
            exerciseName: "Bench Press",
            order: 0,
            sets: [
              {
                tempId: "set-1",
                setNumber: 1,
                reps: 10,
                weight: 135,
                rpe: 7,
              },
            ],
            rounds: undefined,
            workDurationSeconds: undefined,
            restDurationSeconds: undefined,
            intensity: undefined,
            distance: undefined,
            durationSeconds: undefined,
            pace: undefined,
            heartRate: undefined,
            durationMinutes: undefined,
            notes: "",
          },
        ],
        notes: "",
        templateId: undefined,
      };

      const result = formDataToApiInput(formData);
      expect(result.notes).toBeUndefined();
      expect(result.logs[0]?.notes).toBeUndefined();
    });

    it("should set totalVolume to undefined when 0", () => {
      const formData: WorkoutFormData = {
        workoutType: "cardio",
        exercises: [
          {
            tempId: "ex-1",
            exerciseId: "running-id",
            exerciseName: "Running",
            order: 0,
            sets: [],
            rounds: undefined,
            workDurationSeconds: undefined,
            restDurationSeconds: undefined,
            intensity: undefined,
            distance: 5,
            durationSeconds: 1800,
            pace: undefined,
            heartRate: undefined,
            durationMinutes: undefined,
            notes: "",
          },
        ],
        notes: "",
        templateId: undefined,
      };

      const result = formDataToApiInput(formData);
      expect(result.totalVolume).toBeUndefined();
    });

    it("should use the provided date when set", () => {
      const customDate = new Date("2025-12-25");
      const formData: WorkoutFormData = {
        workoutType: "weightlifting",
        date: customDate,
        exercises: [
          {
            tempId: "ex-1",
            exerciseId: "bench-press-id",
            exerciseName: "Bench Press",
            order: 0,
            sets: [
              { tempId: "set-1", setNumber: 1, reps: 10, weight: 135, rpe: 7 },
            ],
            rounds: undefined,
            workDurationSeconds: undefined,
            restDurationSeconds: undefined,
            intensity: undefined,
            distance: undefined,
            durationSeconds: undefined,
            pace: undefined,
            heartRate: undefined,
            durationMinutes: undefined,
            notes: "",
          },
        ],
        notes: "",
        templateId: undefined,
      };

      const result = formDataToApiInput(formData);
      expect(result.date).toEqual(customDate);
    });

    it("should default to approximately now when date is not provided", () => {
      const before = new Date();
      const formData: WorkoutFormData = {
        workoutType: "weightlifting",
        exercises: [
          {
            tempId: "ex-1",
            exerciseId: "bench-press-id",
            exerciseName: "Bench Press",
            order: 0,
            sets: [
              { tempId: "set-1", setNumber: 1, reps: 10, weight: 135, rpe: 7 },
            ],
            rounds: undefined,
            workDurationSeconds: undefined,
            restDurationSeconds: undefined,
            intensity: undefined,
            distance: undefined,
            durationSeconds: undefined,
            pace: undefined,
            heartRate: undefined,
            durationMinutes: undefined,
            notes: "",
          },
        ],
        notes: "",
        templateId: undefined,
        // date intentionally omitted
      };
      const after = new Date();

      const result = formDataToApiInput(formData);
      expect(result.date.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.date.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe("formatVolume", () => {
    it("should format volumes under 1000 with locale string", () => {
      expect(formatVolume(500)).toBe("500");
      expect(formatVolume(999)).toBe("999");
    });

    it("should format volumes >= 1000 with k suffix", () => {
      expect(formatVolume(1000)).toBe("1.0k");
      expect(formatVolume(1500)).toBe("1.5k");
      expect(formatVolume(12345)).toBe("12.3k");
    });

    it("should handle 0", () => {
      expect(formatVolume(0)).toBe("0");
    });
  });

  describe("formatDuration", () => {
    it("should format minutes under 60 with m suffix", () => {
      expect(formatDuration(30)).toBe("30m");
      expect(formatDuration(59)).toBe("59m");
    });

    it("should format hours only when no remainder minutes", () => {
      expect(formatDuration(60)).toBe("1h");
      expect(formatDuration(120)).toBe("2h");
    });

    it("should format hours and minutes when there's a remainder", () => {
      expect(formatDuration(90)).toBe("1h 30m");
      expect(formatDuration(125)).toBe("2h 5m");
    });

    it("should handle 0", () => {
      expect(formatDuration(0)).toBe("0m");
    });
  });

  describe("constants", () => {
    it("WORKOUT_TYPE_LABELS should contain all workout types", () => {
      expect(WORKOUT_TYPE_LABELS).toHaveProperty("weightlifting");
      expect(WORKOUT_TYPE_LABELS).toHaveProperty("hiit");
      expect(WORKOUT_TYPE_LABELS).toHaveProperty("cardio");
      expect(WORKOUT_TYPE_LABELS).toHaveProperty("calisthenics");
      expect(WORKOUT_TYPE_LABELS).toHaveProperty("yoga");
      expect(WORKOUT_TYPE_LABELS).toHaveProperty("sports");
      expect(WORKOUT_TYPE_LABELS).toHaveProperty("mixed");
    });

    it("EXERCISE_CATEGORY_LABELS should contain all categories", () => {
      expect(EXERCISE_CATEGORY_LABELS).toHaveProperty("chest");
      expect(EXERCISE_CATEGORY_LABELS).toHaveProperty("back");
      expect(EXERCISE_CATEGORY_LABELS).toHaveProperty("shoulders");
      expect(EXERCISE_CATEGORY_LABELS).toHaveProperty("arms");
      expect(EXERCISE_CATEGORY_LABELS).toHaveProperty("legs");
      expect(EXERCISE_CATEGORY_LABELS).toHaveProperty("core");
      expect(EXERCISE_CATEGORY_LABELS).toHaveProperty("cardio");
      expect(EXERCISE_CATEGORY_LABELS).toHaveProperty("other");
    });
  });

  describe("apiWorkoutToFormData", () => {
    it("should map workout payload into editable form shape", () => {
      const workout = {
        workoutType: "weightlifting" as const,
        notes: "Heavy day",
        templateId: "template-1",
        date: new Date("2026-01-10T12:00:00.000Z"),
        logs: [
          {
            exerciseId: "exercise-1",
            exerciseName: "Bench Press",
            order: 0,
            rounds: null,
            workDurationSeconds: null,
            restDurationSeconds: null,
            intensity: null,
            distance: null,
            durationSeconds: null,
            pace: null,
            heartRate: null,
            durationMinutes: null,
            notes: "Top set felt good",
            sets: [
              { setNumber: 1, reps: 10, weight: 135, rpe: 7 },
              { setNumber: 2, reps: 8, weight: 145, rpe: 8 },
            ],
          },
        ],
      };

      const form = apiWorkoutToFormData(workout);

      expect(form.workoutType).toBe("weightlifting");
      expect(form.notes).toBe("Heavy day");
      expect(form.templateId).toBe("template-1");
      expect(form.date?.toISOString()).toBe("2026-01-10T12:00:00.000Z");
      expect(form.exercises).toHaveLength(1);
      expect(form.exercises[0]?.exerciseName).toBe("Bench Press");
      expect(form.exercises[0]?.sets).toHaveLength(2);
      expect(form.exercises[0]?.sets[0]?.reps).toBe(10);
      expect(form.exercises[0]?.sets[1]?.weight).toBe(145);
    });

    it("should add one blank set when a workout log has no sets", () => {
      const workout = {
        workoutType: "cardio" as const,
        notes: null,
        templateId: null,
        date: "2026-01-10T12:00:00.000Z",
        logs: [
          {
            exerciseId: null,
            exerciseName: "Run",
            order: 0,
            rounds: null,
            workDurationSeconds: null,
            restDurationSeconds: null,
            intensity: null,
            distance: 5,
            durationSeconds: 1800,
            pace: 6,
            heartRate: 150,
            durationMinutes: 30,
            notes: null,
            sets: [],
          },
        ],
      };

      const form = apiWorkoutToFormData(workout);

      expect(form.exercises[0]?.sets).toHaveLength(1);
      expect(form.exercises[0]?.sets[0]?.setNumber).toBe(1);
      expect(form.exercises[0]?.sets[0]?.reps).toBeUndefined();
      expect(form.exercises[0]?.sets[0]?.weight).toBeUndefined();
    });
  });

  describe("templateToWorkoutFormData", () => {
    it("should prefill workout exercises from template and apply progression weight/reps", () => {
      const form = templateToWorkoutFormData(
        {
          id: "template-1",
          workoutType: "weightlifting",
          notes: "Push day",
          exercises: [
            { exerciseId: "ex-1", order: 0, defaultSets: 3 },
            { exerciseId: "ex-2", order: 1, defaultSets: 2 },
          ],
        },
        {
          exerciseNameById: {
            "ex-1": "Bench Press",
            "ex-2": "Dumbbell Press",
          },
          suggestionsByExerciseId: {
            "ex-1": {
              type: "increase_weight",
              details: {
                currentValue: 135,
                suggestedValue: 140,
                unit: "lbs",
              },
            },
            "ex-2": {
              type: "increase_reps",
              details: {
                currentValue: 8,
                suggestedValue: 9,
                unit: "reps",
              },
            },
          },
          date: new Date("2026-01-15T12:00:00.000Z"),
        },
      );

      expect(form.templateId).toBe("template-1");
      expect(form.notes).toBe("Push day");
      expect(form.exercises).toHaveLength(2);
      expect(form.exercises[0]?.exerciseName).toBe("Bench Press");
      expect(form.exercises[0]?.sets).toHaveLength(3);
      expect(form.exercises[0]?.sets[0]?.weight).toBe(140);
      expect(form.exercises[1]?.sets[0]?.reps).toBe(9);
    });

    it("should use add_set suggestion to increase set count", () => {
      const form = templateToWorkoutFormData(
        {
          id: "template-2",
          workoutType: "weightlifting",
          notes: null,
          exercises: [{ exerciseId: "ex-3", order: 0, defaultSets: 3 }],
        },
        {
          suggestionsByExerciseId: {
            "ex-3": {
              type: "add_set",
              details: {
                currentValue: 3,
                suggestedValue: 4,
                unit: "sets",
              },
            },
          },
        },
      );

      expect(form.exercises[0]?.sets).toHaveLength(4);
    });
  });
});
