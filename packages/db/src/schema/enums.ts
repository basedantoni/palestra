import { pgEnum } from "drizzle-orm/pg-core";

export const weightUnitEnum = pgEnum("weight_unit", ["lbs", "kg"]);
export const distanceUnitEnum = pgEnum("distance_unit", ["mi", "km"]);
export const muscleGroupSystemEnum = pgEnum("muscle_group_system", [
  "bodybuilding",
  "movement_patterns",
]);
export const themeEnum = pgEnum("theme", ["light", "dark", "auto"]);

export const workoutTypeEnum = pgEnum("workout_type", [
  "weightlifting",
  "hiit",
  "cardio",
  "mobility",
  "calisthenics",
  "yoga",
  "sports",
  "mixed",
]);

export const exerciseCategoryEnum = pgEnum("exercise_category", [
  "chest",
  "back",
  "shoulders",
  "arms",
  "legs",
  "core",
  "cardio",
  "other",
]);

export const muscleGroupBodybuildingEnum = pgEnum("muscle_group_bodybuilding", [
  "chest",
  "back",
  "shoulders",
  "arms",
  "legs",
  "core",
]);

export const muscleGroupMovementEnum = pgEnum("muscle_group_movement", [
  "push",
  "pull",
  "squat",
  "hinge",
  "carry",
  "isometric",
]);

export const muscleGroupEnum = pgEnum("muscle_group", [
  "chest",
  "back",
  "shoulders",
  "arms",
  "legs",
  "core",
  "push",
  "pull",
  "squat",
  "hinge",
  "carry",
  "isometric",
]);

export const recordTypeEnum = pgEnum("record_type", [
  "max_weight",
  "max_reps",
  "max_volume",
  "best_pace",
  "longest_distance",
]);

export const trendStatusEnum = pgEnum("trend_status", [
  "improving",
  "plateau",
  "declining",
]);

export const fitnessGoalEnum = pgEnum("fitness_goal", [
  "build_muscle",
  "lose_fat",
  "increase_strength",
  "improve_endurance",
  "general_fitness",
  "flexibility",
]);

export const experienceLevelEnum = pgEnum("experience_level", [
  "beginner",
  "intermediate",
  "advanced",
]);

export const genderEnum = pgEnum("gender", [
  "male",
  "female",
  "other",
  "prefer_not_to_say",
]);

export const customExerciseStatusEnum = pgEnum("custom_exercise_status", [
  "pending",
  "approved",
  "rejected",
  "imported",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "custom_exercise_approved",
  "custom_exercise_rejected",
]);

export const cardioSubtypeEnum = pgEnum("cardio_subtype", [
  "running",
  "cycling",
  "swimming",
  "rowing",
  "other",
]);
