/**
 * Mapping from Whoop sport_id to app workoutType.
 * Unknown IDs default to "mixed".
 * Sport IDs sourced from Whoop API documentation.
 */

export type WorkoutType =
  | "weightlifting"
  | "hiit"
  | "cardio"
  | "calisthenics"
  | "yoga"
  | "sports"
  | "mixed";

export const WHOOP_SPORT_ID_TO_WORKOUT_TYPE: Record<number, WorkoutType> = {
  // Strength / Weightlifting
  0: "weightlifting",   // Weightlifting
  28: "weightlifting",  // Powerlifting
  47: "weightlifting",  // Functional Fitness (alt id)
  126: "weightlifting", // Functional Fitness

  // Cardio
  1: "cardio",    // Running
  16: "cardio",   // Cycling
  25: "cardio",   // Swimming
  35: "cardio",   // Rowing
  49: "cardio",   // Walking
  73: "cardio",   // Cycling (duplicate alias)
  74: "cardio",   // Elliptical
  75: "cardio",   // Stairmaster/Stepper
  76: "cardio",   // Hiking
  78: "cardio",   // Skiing
  79: "cardio",   // Snowboarding
  80: "cardio",   // Skating

  // HIIT
  71: "hiit",    // HIIT

  // Yoga / Flexibility
  72: "yoga",    // Yoga

  // Calisthenics
  46: "calisthenics", // Gymnastics/Calisthenics

  // Sports
  2: "sports",   // Soccer
  3: "sports",   // American Football
  4: "sports",   // Baseball
  5: "sports",   // Basketball
  6: "sports",   // Tennis
  7: "sports",   // Swimming (competitive)
  8: "sports",   // Golf
  9: "sports",   // Ice Bath
  10: "sports",  // Lacrosse
  11: "sports",  // Rugby
  12: "sports",  // Volleyball
  15: "sports",  // Hockey
  27: "sports",  // Boxing
  31: "sports",  // MMA
  32: "sports",  // Martial Arts
  33: "sports",  // Wrestling
  34: "sports",  // Cricket
  36: "sports",  // Racquetball
  37: "sports",  // Rock Climbing
  38: "sports",  // Squash
  39: "sports",  // Ultimate Frisbee
  40: "sports",  // Badminton
  41: "sports",  // Table Tennis
  44: "sports",  // Pickleball
  45: "sports",  // Handball
  48: "sports",  // Cross Country Skiing
  50: "sports",  // Surfing
  54: "sports",  // Paddle Tennis
  55: "sports",  // Archery
  56: "sports",  // Fencing
  57: "sports",  // Kickboxing
  58: "sports",  // Cheerleading
  60: "sports",  // Horseback Riding
  64: "sports",  // Softball
  65: "sports",  // Bowling
  66: "sports",  // Dance
  68: "sports",  // Lacrosse (alt)

  // Mixed / Generic
  [-1 as number]: "mixed", // Activity (generic)
  [-2 as number]: "mixed", // Health (generic)
  82: "mixed",  // Meditation
  163: "mixed", // Pickleball (newer id)
};

/**
 * Whoop sport ID to human-readable sport name map.
 */
export const WHOOP_SPORT_ID_TO_NAME: Record<number, string> = {
  [-1 as number]: "Activity",
  [-2 as number]: "Health",
  0: "Weightlifting",
  1: "Running",
  2: "Soccer",
  3: "American Football",
  4: "Baseball",
  5: "Basketball",
  6: "Tennis",
  7: "Swimming",
  8: "Golf",
  9: "Ice Bath",
  10: "Lacrosse",
  11: "Rugby",
  12: "Volleyball",
  15: "Hockey",
  16: "Cycling",
  25: "Swimming",
  27: "Boxing",
  28: "Powerlifting",
  31: "MMA",
  32: "Martial Arts",
  33: "Wrestling",
  34: "Cricket",
  35: "Rowing",
  36: "Racquetball",
  37: "Rock Climbing",
  38: "Squash",
  39: "Ultimate Frisbee",
  40: "Badminton",
  41: "Table Tennis",
  44: "Pickleball",
  45: "Handball",
  46: "Gymnastics",
  47: "Functional Fitness",
  48: "Cross Country Skiing",
  49: "Walking",
  50: "Surfing",
  54: "Paddle Tennis",
  55: "Archery",
  56: "Fencing",
  57: "Kickboxing",
  58: "Cheerleading",
  60: "Horseback Riding",
  64: "Softball",
  65: "Bowling",
  66: "Dance",
  68: "Lacrosse",
  71: "HIIT",
  72: "Yoga",
  73: "Cycling",
  74: "Elliptical",
  75: "Stairmaster",
  76: "Hiking",
  78: "Skiing",
  79: "Snowboarding",
  80: "Skating",
  82: "Meditation",
  126: "Functional Fitness",
  163: "Pickleball",
};

/**
 * Returns the app workoutType for a given Whoop sport_id.
 * Defaults to "mixed" for unknown IDs.
 */
export function whoopSportIdToWorkoutType(sportId: number): WorkoutType {
  return WHOOP_SPORT_ID_TO_WORKOUT_TYPE[sportId] ?? "mixed";
}

/**
 * Returns the human-readable sport name for a given Whoop sport_id.
 * Defaults to "Unknown Activity" for unknown IDs.
 */
export function whoopSportIdToName(sportId: number): string {
  return WHOOP_SPORT_ID_TO_NAME[sportId] ?? "Unknown Activity";
}
