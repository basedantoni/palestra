import z from "zod";

// Step 1: Goals & Experience
export const stepGoalsSchema = z.object({
  fitnessGoal: z.enum([
    "build_muscle",
    "lose_fat",
    "increase_strength",
    "improve_endurance",
    "general_fitness",
    "flexibility",
  ]),
  experienceLevel: z.enum([
    "beginner",
    "intermediate",
    "advanced",
  ]),
});

// Step 2: Workout Preferences
export const stepWorkoutsSchema = z.object({
  preferredWorkoutTypes: z
    .array(
      z.enum(["weightlifting", "hiit", "cardio", "calisthenics", "yoga", "sports"])
    )
    .min(1, "Select at least one workout type"),
});

// Step 3: Body Metrics (all optional)
export const stepMetricsSchema = z.object({
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).optional(),
  birthYear: z
    .number()
    .int()
    .min(1920, "Please enter a valid year")
    .max(2020, "Please enter a valid year")
    .optional(),
  heightCm: z
    .number()
    .min(50, "Please enter a valid height")
    .max(300, "Please enter a valid height")
    .optional(),
  weightKg: z
    .number()
    .min(20, "Please enter a valid weight")
    .max(500, "Please enter a valid weight")
    .optional(),
});

// Step 4: App Preferences
export const stepPreferencesSchema = z.object({
  weightUnit: z.enum(["lbs", "kg"]),
  distanceUnit: z.enum(["mi", "km"]),
  muscleGroupSystem: z.enum(["bodybuilding", "movement_patterns"]),
  theme: z.enum(["light", "dark", "auto"]),
});

// Combined schema for the entire form (used in validators.onSubmit)
export const onboardingSchema = stepGoalsSchema
  .merge(stepWorkoutsSchema)
  .merge(stepMetricsSchema)
  .merge(stepPreferencesSchema);

export type OnboardingFormData = z.infer<typeof onboardingSchema>;

// Field names grouped by step, for per-step validation
// NOTE: Step 3 is preferences (units), Step 4 is metrics (height/weight)
// This order allows users to select their preferred units before entering measurements
export const STEP_FIELD_NAMES: ReadonlyArray<ReadonlyArray<keyof OnboardingFormData>> = [
  ["fitnessGoal", "experienceLevel"],
  ["preferredWorkoutTypes"],
  ["weightUnit", "distanceUnit", "muscleGroupSystem", "theme"],
  ["gender", "birthYear", "heightCm", "weightKg"],
];

export const TOTAL_STEPS = STEP_FIELD_NAMES.length;
