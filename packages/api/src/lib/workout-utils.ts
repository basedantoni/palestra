// Cross-platform UUID generator for temporary IDs
function generateTempId(): string {
  // Use crypto.randomUUID if available (web), otherwise use timestamp + random
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for React Native
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

// Types for the workout logging form state (client-side)
export interface WorkoutSetFormData {
  tempId: string; // Client-side temporary ID for React keys
  setNumber: number;
  reps: number | undefined;
  weight: number | undefined;
  rpe: number | undefined;
}

export interface WorkoutExerciseFormData {
  tempId: string;
  exerciseId: string | undefined;
  exerciseName: string;
  order: number;
  sets: WorkoutSetFormData[];
  // HIIT fields
  rounds: number | undefined;
  workDurationSeconds: number | undefined;
  restDurationSeconds: number | undefined;
  intensity: number | undefined;
  // Cardio fields
  distance: number | undefined;
  durationSeconds: number | undefined;
  pace: number | undefined;
  heartRate: number | undefined;
  // Yoga/Sports
  durationMinutes: number | undefined;
  notes: string;
}

export interface WorkoutFormData {
  workoutType:
    | "weightlifting"
    | "hiit"
    | "cardio"
    | "calisthenics"
    | "yoga"
    | "sports"
    | "mixed";
  exercises: WorkoutExerciseFormData[];
  notes: string;
  templateId: string | undefined;
}

// Volume calculation (client-side)
export function calculateSetVolume(set: WorkoutSetFormData): number {
  const reps = set.reps ?? 0;
  const weight = set.weight ?? 0;
  return reps * weight;
}

export function calculateExerciseVolume(
  exercise: WorkoutExerciseFormData,
): number {
  return exercise.sets.reduce(
    (total, set) => total + calculateSetVolume(set),
    0,
  );
}

export function calculateTotalVolume(
  exercises: WorkoutExerciseFormData[],
): number {
  return exercises.reduce(
    (total, ex) => total + calculateExerciseVolume(ex),
    0,
  );
}

// Create a blank set for a given set number
export function createBlankSet(setNumber: number): WorkoutSetFormData {
  return {
    tempId: generateTempId(),
    setNumber,
    reps: undefined,
    weight: undefined,
    rpe: undefined,
  };
}

// Create a blank exercise entry
export function createBlankExercise(order: number): WorkoutExerciseFormData {
  return {
    tempId: generateTempId(),
    exerciseId: undefined,
    exerciseName: "",
    order,
    sets: [createBlankSet(1)],
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
}

// Convert form data to API input shape
export function formDataToApiInput(form: WorkoutFormData) {
  const exercises = form.exercises.filter(
    (ex) => ex.exerciseName.trim() !== "",
  );
  const totalVolume = calculateTotalVolume(exercises);

  return {
    date: new Date(),
    workoutType: form.workoutType,
    notes: form.notes || undefined,
    templateId: form.templateId,
    totalVolume: totalVolume > 0 ? totalVolume : undefined,
    logs: exercises.map((ex, idx) => ({
      ...(ex.exerciseId ? { exerciseId: ex.exerciseId } : {}),
      exerciseName: ex.exerciseName,
      order: idx,
      rounds: ex.rounds,
      workDurationSeconds: ex.workDurationSeconds,
      restDurationSeconds: ex.restDurationSeconds,
      intensity: ex.intensity,
      distance: ex.distance,
      durationSeconds: ex.durationSeconds,
      pace: ex.pace,
      heartRate: ex.heartRate,
      durationMinutes: ex.durationMinutes,
      notes: ex.notes || undefined,
      sets: ex.sets
        .filter((s) => s.reps !== undefined || s.weight !== undefined)
        .map((s) => ({
          setNumber: s.setNumber,
          reps: s.reps,
          weight: s.weight,
          rpe: s.rpe,
        })),
    })),
  };
}

// Display helpers
export const WORKOUT_TYPE_LABELS: Record<string, string> = {
  weightlifting: "Weightlifting",
  hiit: "HIIT",
  cardio: "Cardio",
  calisthenics: "Calisthenics",
  yoga: "Yoga",
  sports: "Sports",
  mixed: "Mixed",
};

export const EXERCISE_CATEGORY_LABELS: Record<string, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  arms: "Arms",
  legs: "Legs",
  core: "Core",
  cardio: "Cardio",
  other: "Other",
};

export function formatVolume(volume: number): string {
  if (volume >= 1000) {
    return `${(volume / 1000).toFixed(1)}k`;
  }
  return volume.toLocaleString();
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
