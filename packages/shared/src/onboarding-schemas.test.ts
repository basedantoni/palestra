import { describe, it, expect } from "vitest";
import {
  stepGoalsSchema,
  stepWorkoutsSchema,
  stepMetricsSchema,
  stepPreferencesSchema,
  onboardingSchema,
  preferencesInputSchema,
  STEP_FIELD_NAMES,
  TOTAL_STEPS,
} from "./onboarding-schemas";

describe("stepWorkoutsSchema", () => {
  it("accepts one or more workout types", () => {
    const result = stepWorkoutsSchema.safeParse({
      preferredWorkoutTypes: ["weightlifting", "cardio"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty workout types array", () => {
    const result = stepWorkoutsSchema.safeParse({
      preferredWorkoutTypes: [],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Select at least one workout type");
  });

  it("rejects an invalid workout type value", () => {
    const result = stepWorkoutsSchema.safeParse({
      preferredWorkoutTypes: ["pilates"],
    });
    expect(result.success).toBe(false);
  });
});

describe("stepMetricsSchema", () => {
  it("passes with all fields omitted", () => {
    const result = stepMetricsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects a birthYear below 1920", () => {
    const result = stepMetricsSchema.safeParse({ birthYear: 1919 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Please enter a valid year");
  });

  it("rejects a birthYear above 2020", () => {
    const result = stepMetricsSchema.safeParse({ birthYear: 2021 });
    expect(result.success).toBe(false);
  });

  it("rejects a heightCm out of range", () => {
    const result = stepMetricsSchema.safeParse({ heightCm: 400 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Please enter a valid height");
  });

  it("rejects a weightKg out of range", () => {
    const result = stepMetricsSchema.safeParse({ weightKg: 10 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Please enter a valid weight");
  });

  it("accepts all fields with valid values", () => {
    const result = stepMetricsSchema.safeParse({
      gender: "male",
      birthYear: 1990,
      heightCm: 180,
      weightKg: 80,
    });
    expect(result.success).toBe(true);
  });
});

describe("stepPreferencesSchema", () => {
  it("accepts a valid preferences combination", () => {
    const result = stepPreferencesSchema.safeParse({
      weightUnit: "lbs",
      distanceUnit: "mi",
      muscleGroupSystem: "bodybuilding",
      theme: "dark",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid weightUnit", () => {
    const result = stepPreferencesSchema.safeParse({
      weightUnit: "stones",
      distanceUnit: "mi",
      muscleGroupSystem: "bodybuilding",
      theme: "dark",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const result = stepPreferencesSchema.safeParse({
      weightUnit: "kg",
      distanceUnit: "km",
      muscleGroupSystem: "movement_patterns",
      // theme omitted
    });
    expect(result.success).toBe(false);
  });
});

describe("onboardingSchema", () => {
  it("accepts a complete valid onboarding payload", () => {
    const result = onboardingSchema.safeParse({
      fitnessGoal: "lose_fat",
      experienceLevel: "intermediate",
      preferredWorkoutTypes: ["hiit", "cardio"],
      weightUnit: "kg",
      distanceUnit: "km",
      muscleGroupSystem: "movement_patterns",
      theme: "auto",
      gender: "female",
      birthYear: 1995,
      heightCm: 165,
      weightKg: 65,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a payload with all optional metric fields omitted", () => {
    const result = onboardingSchema.safeParse({
      fitnessGoal: "general_fitness",
      experienceLevel: "beginner",
      preferredWorkoutTypes: ["yoga"],
      weightUnit: "lbs",
      distanceUnit: "mi",
      muscleGroupSystem: "bodybuilding",
      theme: "light",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when preferredWorkoutTypes is empty", () => {
    const result = onboardingSchema.safeParse({
      fitnessGoal: "build_muscle",
      experienceLevel: "advanced",
      preferredWorkoutTypes: [],
      weightUnit: "lbs",
      distanceUnit: "mi",
      muscleGroupSystem: "bodybuilding",
      theme: "dark",
    });
    expect(result.success).toBe(false);
  });
});

describe("stepGoalsSchema", () => {
  it("accepts a valid fitness goal and experience level", () => {
    const result = stepGoalsSchema.safeParse({
      fitnessGoal: "build_muscle",
      experienceLevel: "beginner",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when fitnessGoal is missing", () => {
    const result = stepGoalsSchema.safeParse({
      experienceLevel: "beginner",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid fitnessGoal value", () => {
    const result = stepGoalsSchema.safeParse({
      fitnessGoal: "get_rich",
      experienceLevel: "beginner",
    });
    expect(result.success).toBe(false);
  });
});

describe("preferencesInputSchema", () => {
  it("accepts a full preferences payload with all onboarding fields", () => {
    const result = preferencesInputSchema.safeParse({
      weightUnit: "kg",
      distanceUnit: "km",
      muscleGroupSystem: "bodybuilding",
      theme: "dark",
      plateauThreshold: 3,
      fitnessGoal: "build_muscle",
      experienceLevel: "intermediate",
      preferredWorkoutTypes: ["weightlifting"],
      onboardingCompleted: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a payload with only the required preference fields", () => {
    const result = preferencesInputSchema.safeParse({
      weightUnit: "lbs",
      distanceUnit: "mi",
      muscleGroupSystem: "movement_patterns",
      theme: "light",
      plateauThreshold: 5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects when plateauThreshold is out of range", () => {
    const result = preferencesInputSchema.safeParse({
      weightUnit: "lbs",
      distanceUnit: "mi",
      muscleGroupSystem: "bodybuilding",
      theme: "auto",
      plateauThreshold: 25,
    });
    expect(result.success).toBe(false);
  });
});

describe("STEP_FIELD_NAMES", () => {
  it("has exactly 4 steps matching TOTAL_STEPS", () => {
    expect(STEP_FIELD_NAMES).toHaveLength(TOTAL_STEPS);
    expect(TOTAL_STEPS).toBe(4);
  });

  it("groups goals fields in step 1", () => {
    expect(STEP_FIELD_NAMES[0]).toContain("fitnessGoal");
    expect(STEP_FIELD_NAMES[0]).toContain("experienceLevel");
  });

  it("groups workout types in step 2", () => {
    expect(STEP_FIELD_NAMES[1]).toContain("preferredWorkoutTypes");
  });

  it("groups preference fields in step 3", () => {
    expect(STEP_FIELD_NAMES[2]).toContain("weightUnit");
    expect(STEP_FIELD_NAMES[2]).toContain("distanceUnit");
    expect(STEP_FIELD_NAMES[2]).toContain("muscleGroupSystem");
    expect(STEP_FIELD_NAMES[2]).toContain("theme");
  });

  it("groups metric fields in step 4", () => {
    expect(STEP_FIELD_NAMES[3]).toContain("gender");
    expect(STEP_FIELD_NAMES[3]).toContain("birthYear");
    expect(STEP_FIELD_NAMES[3]).toContain("heightCm");
    expect(STEP_FIELD_NAMES[3]).toContain("weightKg");
  });
});
