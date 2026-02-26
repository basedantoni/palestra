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

// Option constants
export const GOALS = [
  { value: "build_muscle", label: "Build Muscle", description: "Gain size and definition" },
  { value: "lose_fat", label: "Lose Fat", description: "Cut body fat while maintaining muscle" },
  { value: "increase_strength", label: "Increase Strength", description: "Lift heavier weights" },
  { value: "improve_endurance", label: "Improve Endurance", description: "Better cardiovascular fitness" },
  { value: "general_fitness", label: "General Fitness", description: "Overall health and wellness" },
  { value: "flexibility", label: "Flexibility", description: "Improve mobility and range of motion" },
] as const;

export const EXPERIENCE_LEVELS = [
  { value: "beginner", label: "Beginner", description: "New to fitness or less than 6 months" },
  { value: "intermediate", label: "Intermediate", description: "6 months to 2 years of training" },
  { value: "advanced", label: "Advanced", description: "2+ years of consistent training" },
] as const;

export const WORKOUT_TYPES = [
  { value: "weightlifting", label: "Weightlifting", description: "Barbell, dumbbell, and machine exercises" },
  { value: "hiit", label: "HIIT", description: "High-intensity interval training" },
  { value: "cardio", label: "Cardio", description: "Running, cycling, rowing, swimming" },
  { value: "calisthenics", label: "Calisthenics", description: "Bodyweight exercises" },
  { value: "yoga", label: "Yoga & Flexibility", description: "Stretching and mobility work" },
  { value: "sports", label: "Sports", description: "Basketball, tennis, hiking, etc." },
] as const;

export const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

export const WEIGHT_UNITS = [
  { value: "lbs", label: "Pounds (lbs)" },
  { value: "kg", label: "Kilograms (kg)" },
] as const;

export const DISTANCE_UNITS = [
  { value: "mi", label: "Miles (mi)" },
  { value: "km", label: "Kilometers (km)" },
] as const;

export const MUSCLE_GROUP_SYSTEMS = [
  { value: "bodybuilding", label: "Bodybuilding", description: "Chest, Back, Shoulders, Arms, Legs, Core" },
  { value: "movement_patterns", label: "Movement Patterns", description: "Push, Pull, Squat, Hinge, Carry" },
] as const;

export const THEMES = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "auto", label: "Auto (System)" },
] as const;
