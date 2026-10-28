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
  "whoop_workout_imported",
  "market_capture_failed",
  "database_near_full",
]);

export const cardioSubtypeEnum = pgEnum("cardio_subtype", [
  "running",
  "cycling",
  "swimming",
  "rowing",
  "other",
]);

export const recalcJobKindEnum = pgEnum("recalc_job_kind", [
  "progressive_overload",
  "muscle_group_volume",
]);

export const recalcJobStatusEnum = pgEnum("recalc_job_status", [
  "pending",
  "processing",
  "done",
  "failed",
]);

export const accountTypeEnum = pgEnum("account_type", [
  "depository",
  "credit",
  "investment",
  "loan",
]);

/** Where a financial account is synced from (KOI-318). */
export const accountSourceEnum = pgEnum("account_source", ["plaid", "snaptrade"]);

export const transactionFlowEnum = pgEnum("transaction_flow", [
  "income",
  "expense",
  "transfer",
]);

/** Plaid environment that issued an item's access token; tokens only work there (KOI-288). */
export const plaidEnvEnum = pgEnum("plaid_env", ["sandbox", "production"]);

export const tcgLanguageEnum = pgEnum("tcg_language", ["ja", "en"]);
export const tcgVariantKindEnum = pgEnum("tcg_variant_kind", ["base", "parallel", "manga", "reprint"]);
/** Condition, best first: NM > LP > MP > HP > DMG. "At least LP" compares positions in this order. Shared by Wants and Copies. */
export const tcgConditionEnum = pgEnum("tcg_condition", ["NM", "LP", "MP", "HP", "DMG"]);
export const tcgMarketplaceEnum = pgEnum("tcg_marketplace", ["tcgplayer", "cardtrader"]);
export const tcgMatchMethodEnum = pgEnum("tcg_match_method", ["rule", "tcgplayer_id", "typesafe", "manual"]);
export const tcgWantStatusEnum = pgEnum("tcg_want_status", ["open", "ordered", "fulfilled", "dropped"]);

/** How a Rule's Pattern matches a bank description (KOI-339). */
export const ruleMatchModeEnum = pgEnum("rule_match_mode", ["exact", "contains"]);
