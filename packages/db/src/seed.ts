import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { db } from "./index";
import { exercise, workoutTemplate, workoutTemplateExercise } from "./schema";

type MuscleGroupBodybuilding = "chest" | "back" | "shoulders" | "arms" | "legs" | "core";
type MuscleGroupMovement = "push" | "pull" | "squat" | "hinge" | "carry";
type SeedExercise = {
  name: string;
  category: "chest" | "back" | "shoulders" | "arms" | "legs" | "core" | "cardio" | "other";
  exerciseType:
    | "weightlifting"
    | "hiit"
    | "cardio"
    | "calisthenics"
    | "yoga"
    | "sports"
    | "mixed"
    | "mobility";
  muscleGroupsBodybuilding: MuscleGroupBodybuilding[];
  muscleGroupsMovement: MuscleGroupMovement[];
  isCustom: false;
  createdByUserId: null;
};
type SeedTemplate = {
  name: string;
  workoutType:
    | "weightlifting"
    | "hiit"
    | "cardio"
    | "calisthenics"
    | "yoga"
    | "sports"
    | "mixed";
  exercises: string[];
};

// Create deterministic UUID from exercise name for idempotency
// Generates a valid UUID v5 format by setting the version and variant bits
export function deterministicUUID(name: string): string {
  const hash = createHash("md5").update(name).digest("hex");

  // Split the hash into UUID segments
  const segment1 = hash.slice(0, 8);
  const segment2 = hash.slice(8, 12);
  let segment3 = hash.slice(12, 16);
  let segment4 = hash.slice(16, 20);
  const segment5 = hash.slice(20, 32);

  // Set version to 5 (UUID v5): replace first character of segment3
  segment3 = '5' + segment3.slice(1);

  // Set variant bits (10xx): ensure first character of segment4 is 8, 9, a, or b
  const firstChar = parseInt(segment4[0], 16);
  const variantChar = (8 + (firstChar % 4)).toString(16); // Ensures 8, 9, a, or b
  segment4 = variantChar + segment4.slice(1);

  return `${segment1}-${segment2}-${segment3}-${segment4}-${segment5}`;
}

function createSeedExercise(
  name: string,
  category: SeedExercise["category"],
  exerciseType: SeedExercise["exerciseType"],
  muscleGroupsBodybuilding: MuscleGroupBodybuilding[] = [],
  muscleGroupsMovement: MuscleGroupMovement[] = [],
): SeedExercise {
  return {
    name,
    category,
    exerciseType,
    muscleGroupsBodybuilding,
    muscleGroupsMovement,
    isCustom: false,
    createdByUserId: null,
  };
}

function getTemplateId(name: string): string {
  return deterministicUUID(`template:${name}`);
}

function getTemplateExerciseId(
  templateName: string,
  exerciseName: string,
  order: number,
): string {
  return deterministicUUID(
    `template-exercise:${templateName}:${order}:${exerciseName}`,
  );
}

const BASE_SEED_EXERCISES = [
  // Chest (8 exercises)
  {
    name: "Barbell Bench Press",
    category: "chest" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["chest", "shoulders", "arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Incline Barbell Bench Press",
    category: "chest" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["chest", "shoulders"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Dumbbell Bench Press",
    category: "chest" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["chest", "shoulders", "arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Incline Dumbbell Press",
    category: "chest" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["chest", "shoulders"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Cable Fly",
    category: "chest" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["chest"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Chest Dip",
    category: "chest" as const,
    exerciseType: "calisthenics" as const,
    muscleGroupsBodybuilding: ["chest", "shoulders", "arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Push-Up",
    category: "chest" as const,
    exerciseType: "calisthenics" as const,
    muscleGroupsBodybuilding: ["chest", "shoulders", "arms", "core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Dumbbell Fly",
    category: "chest" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["chest"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },

  // Back (8 exercises)
  {
    name: "Barbell Row",
    category: "back" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["back", "arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Pull-Up",
    category: "back" as const,
    exerciseType: "calisthenics" as const,
    muscleGroupsBodybuilding: ["back", "arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Lat Pulldown",
    category: "back" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["back", "arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Seated Cable Row",
    category: "back" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["back", "arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Dumbbell Row",
    category: "back" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["back", "arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "T-Bar Row",
    category: "back" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["back", "arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Face Pull",
    category: "back" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["back", "shoulders"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Chin-Up",
    category: "back" as const,
    exerciseType: "calisthenics" as const,
    muscleGroupsBodybuilding: ["back", "arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },

  // Shoulders (7 exercises)
  {
    name: "Overhead Press",
    category: "shoulders" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["shoulders", "arms", "core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Dumbbell Shoulder Press",
    category: "shoulders" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["shoulders", "arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Lateral Raise",
    category: "shoulders" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["shoulders"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Front Raise",
    category: "shoulders" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["shoulders"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Reverse Fly",
    category: "shoulders" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["shoulders", "back"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Arnold Press",
    category: "shoulders" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["shoulders", "arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Upright Row",
    category: "shoulders" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["shoulders", "arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },

  // Arms (8 exercises)
  {
    name: "Barbell Curl",
    category: "arms" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Dumbbell Curl",
    category: "arms" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Hammer Curl",
    category: "arms" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Tricep Pushdown",
    category: "arms" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Skull Crusher",
    category: "arms" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Overhead Tricep Extension",
    category: "arms" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Preacher Curl",
    category: "arms" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Dip",
    category: "arms" as const,
    exerciseType: "calisthenics" as const,
    muscleGroupsBodybuilding: ["arms", "chest", "shoulders"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },

  // Legs (10 exercises)
  {
    name: "Barbell Squat",
    category: "legs" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["legs", "core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["squat"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Front Squat",
    category: "legs" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["legs", "core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["squat"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Leg Press",
    category: "legs" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["legs"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["squat"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Romanian Deadlift",
    category: "legs" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["legs", "back", "core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["hinge"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Leg Curl",
    category: "legs" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["legs"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Leg Extension",
    category: "legs" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["legs"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Bulgarian Split Squat",
    category: "legs" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["legs", "core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["squat"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Calf Raise",
    category: "legs" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["legs"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Hip Thrust",
    category: "legs" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["legs", "core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["hinge"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Goblet Squat",
    category: "legs" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["legs", "core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["squat"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },

  // Core (5 exercises)
  {
    name: "Plank",
    category: "core" as const,
    exerciseType: "calisthenics" as const,
    muscleGroupsBodybuilding: ["core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Hanging Leg Raise",
    category: "core" as const,
    exerciseType: "calisthenics" as const,
    muscleGroupsBodybuilding: ["core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Cable Crunch",
    category: "core" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Ab Wheel Rollout",
    category: "core" as const,
    exerciseType: "calisthenics" as const,
    muscleGroupsBodybuilding: ["core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Russian Twist",
    category: "core" as const,
    exerciseType: "calisthenics" as const,
    muscleGroupsBodybuilding: ["core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },

  // Compound / Full Body (5 exercises)
  {
    name: "Deadlift",
    category: "other" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["back", "legs", "core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["hinge"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Power Clean",
    category: "other" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["legs", "back", "shoulders"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull", "squat"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Clean and Jerk",
    category: "other" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["legs", "back", "shoulders"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull", "squat", "push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Snatch",
    category: "other" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["legs", "back", "shoulders"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull", "squat"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Farmer's Walk",
    category: "other" as const,
    exerciseType: "weightlifting" as const,
    muscleGroupsBodybuilding: ["arms", "shoulders", "core", "legs"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["carry"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },

  // Cardio (6 exercises)
  {
    name: "Running",
    category: "cardio" as const,
    exerciseType: "cardio" as const,
    muscleGroupsBodybuilding: [] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Cycling",
    category: "cardio" as const,
    exerciseType: "cardio" as const,
    muscleGroupsBodybuilding: [] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Rowing",
    category: "cardio" as const,
    exerciseType: "cardio" as const,
    muscleGroupsBodybuilding: [] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Swimming",
    category: "cardio" as const,
    exerciseType: "cardio" as const,
    muscleGroupsBodybuilding: [] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Jump Rope",
    category: "cardio" as const,
    exerciseType: "cardio" as const,
    muscleGroupsBodybuilding: [] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Elliptical",
    category: "cardio" as const,
    exerciseType: "cardio" as const,
    muscleGroupsBodybuilding: [] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },

  // Calisthenics (5 exercises)
  {
    name: "Muscle-Up",
    category: "other" as const,
    exerciseType: "calisthenics" as const,
    muscleGroupsBodybuilding: ["back", "chest", "arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["pull", "push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Pistol Squat",
    category: "legs" as const,
    exerciseType: "calisthenics" as const,
    muscleGroupsBodybuilding: ["legs", "core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["squat"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Handstand Push-Up",
    category: "shoulders" as const,
    exerciseType: "calisthenics" as const,
    muscleGroupsBodybuilding: ["shoulders", "arms", "core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "L-Sit",
    category: "core" as const,
    exerciseType: "calisthenics" as const,
    muscleGroupsBodybuilding: ["core", "arms"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Bodyweight Squat",
    category: "legs" as const,
    exerciseType: "calisthenics" as const,
    muscleGroupsBodybuilding: ["legs"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["squat"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },

  // HIIT (5 exercises)
  {
    name: "Burpees",
    category: "other" as const,
    exerciseType: "hiit" as const,
    muscleGroupsBodybuilding: ["chest", "legs", "core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["push", "squat"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Mountain Climbers",
    category: "core" as const,
    exerciseType: "hiit" as const,
    muscleGroupsBodybuilding: ["core", "legs"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Box Jumps",
    category: "legs" as const,
    exerciseType: "hiit" as const,
    muscleGroupsBodybuilding: ["legs"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["squat"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Kettlebell Swings",
    category: "other" as const,
    exerciseType: "hiit" as const,
    muscleGroupsBodybuilding: ["legs", "back", "core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: ["hinge"] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Battle Ropes",
    category: "other" as const,
    exerciseType: "hiit" as const,
    muscleGroupsBodybuilding: ["arms", "shoulders", "core"] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },

  // Yoga/Flexibility (3 exercises)
  {
    name: "Vinyasa Flow",
    category: "other" as const,
    exerciseType: "yoga" as const,
    muscleGroupsBodybuilding: [] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Hatha Yoga",
    category: "other" as const,
    exerciseType: "yoga" as const,
    muscleGroupsBodybuilding: [] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Stretching Routine",
    category: "other" as const,
    exerciseType: "yoga" as const,
    muscleGroupsBodybuilding: [] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },

  // Sports (3 exercises)
  {
    name: "Basketball",
    category: "other" as const,
    exerciseType: "sports" as const,
    muscleGroupsBodybuilding: [] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Tennis",
    category: "other" as const,
    exerciseType: "sports" as const,
    muscleGroupsBodybuilding: [] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
  {
    name: "Hiking",
    category: "other" as const,
    exerciseType: "sports" as const,
    muscleGroupsBodybuilding: [] as MuscleGroupBodybuilding[],
    muscleGroupsMovement: [] as MuscleGroupMovement[],
    isCustom: false,
    createdByUserId: null,
  },
];

const RUNNING_CARDIO_EXERCISE_NAMES = [
  "Short Run",
  "Long Run",
  "Tempo Run",
  "Recovery Run",
  "Warm Up Run",
  "Cool Down Run",
  "Fartlek Run",
  "Progression Run",
  "Treadmill Run",
  "Trail Run",
] as const;

const RUNNING_HIIT_EXERCISE_NAMES = [
  "Sprint",
  "Interval Run",
  "Hill Sprint",
  "Strides",
  "400m Repeat",
  "800m Repeat",
  "Mile Repeat",
] as const;

export const RUNNING_SEED_EXERCISES = [
  ...RUNNING_CARDIO_EXERCISE_NAMES.map((name) =>
    createSeedExercise(name, "cardio", "cardio"),
  ),
  ...RUNNING_HIIT_EXERCISE_NAMES.map((name) =>
    createSeedExercise(name, "cardio", "hiit"),
  ),
];

export const MOBILITY_SEED_EXERCISES = [
  "Hip Flexor Stretch",
  "Pigeon Pose",
  "90/90 Hip Stretch",
  "Hip Circle",
  "Lateral Hip Stretch",
  "Butterfly Stretch",
  "Frog Stretch",
  "Couch Stretch",
  "Hamstring Stretch",
  "Seated Hamstring Stretch",
  "Glute Bridge",
  "Figure Four Stretch",
  "Supine Hamstring Stretch",
  "Calf Stretch",
  "Soleus Stretch",
  "Ankle Circle",
  "Ankle Dorsiflexion Stretch",
  "Standing Quad Stretch",
  "Lying Quad Stretch",
  "Cat-Cow",
  "Child's Pose",
  "Supine Twist",
  "Cobra",
  "Knee to Chest Stretch",
  "Thoracic Rotation",
  "Thread the Needle",
  "Thoracic Extension",
  "Lat Stretch",
  "Doorway Chest Stretch",
  "Shoulder Cross-Body Stretch",
  "Sleeper Stretch",
  "Neck Lateral Flexion",
  "World's Greatest Stretch",
  "Inchworm",
  "Leg Swing (Front-Back)",
  "Leg Swing (Lateral)",
  "Hip Opener Walk",
  "Deep Squat Hold",
  "Lunge with Rotation",
].map((name) => createSeedExercise(name, "other", "mobility"));

export const SEED_EXERCISES = [
  ...BASE_SEED_EXERCISES,
  ...RUNNING_SEED_EXERCISES,
  ...MOBILITY_SEED_EXERCISES,
];

export const SYSTEM_TEMPLATES: SeedTemplate[] = [
  {
    name: "Sprint Session",
    workoutType: "hiit",
    exercises: ["Warm Up Run", "Sprint", "Cool Down Run"],
  },
  {
    name: "Short Run",
    workoutType: "cardio",
    exercises: ["Warm Up Run", "Short Run", "Cool Down Run"],
  },
  {
    name: "Long Run",
    workoutType: "cardio",
    exercises: ["Warm Up Run", "Long Run", "Cool Down Run"],
  },
  {
    name: "Interval Session",
    workoutType: "hiit",
    exercises: ["Warm Up Run", "Interval Run", "Strides", "Cool Down Run"],
  },
  {
    name: "Full-Body Mobility",
    workoutType: "yoga",
    exercises: [
      "Cat-Cow",
      "World's Greatest Stretch",
      "Hip Flexor Stretch",
      "Pigeon Pose",
      "90/90 Hip Stretch",
      "Thoracic Rotation",
      "Hamstring Stretch",
      "Couch Stretch",
      "Child's Pose",
      "Supine Twist",
    ],
  },
];

export const SEED_WORKOUT_TEMPLATES = SYSTEM_TEMPLATES.map((template) => ({
  id: getTemplateId(template.name),
  userId: null,
  name: template.name,
  workoutType: template.workoutType,
  notes: null,
  isSystemTemplate: true,
}));

export const SEED_WORKOUT_TEMPLATE_EXERCISES = SYSTEM_TEMPLATES.flatMap(
  (template) =>
    template.exercises.map((exerciseName, order) => ({
      id: getTemplateExerciseId(template.name, exerciseName, order),
      workoutTemplateId: getTemplateId(template.name),
      exerciseId: deterministicUUID(exerciseName),
      order,
      defaultSets: null,
    })),
);

export async function seed() {
  console.log("Seeding exercises and templates...");

  const exercisesWithIds = SEED_EXERCISES.map((ex) => ({
    ...ex,
    id: deterministicUUID(ex.name),
  }));

  await db.transaction(async (tx) => {
    for (const seededExercise of exercisesWithIds) {
      await tx
        .insert(exercise)
        .values(seededExercise)
        .onConflictDoUpdate({
          target: exercise.id,
          set: {
            category: seededExercise.category,
            exerciseType: seededExercise.exerciseType,
            muscleGroupsBodybuilding: seededExercise.muscleGroupsBodybuilding,
            muscleGroupsMovement: seededExercise.muscleGroupsMovement,
            isCustom: seededExercise.isCustom,
            createdByUserId: seededExercise.createdByUserId,
          },
        });
    }
    await tx
      .insert(workoutTemplate)
      .values(SEED_WORKOUT_TEMPLATES)
      .onConflictDoNothing();
    await tx
      .insert(workoutTemplateExercise)
      .values(SEED_WORKOUT_TEMPLATE_EXERCISES)
      .onConflictDoNothing();
  });

  console.log(`Seeded ${SEED_EXERCISES.length} exercises`);
  console.log(`Seeded ${SEED_WORKOUT_TEMPLATES.length} system templates`);
}

const isDirectExecution =
  process.argv[1] != null &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution) {
  seed()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
