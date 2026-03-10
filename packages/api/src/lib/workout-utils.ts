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
  durationSeconds: number | undefined; // for timed/isometric sets; mutually exclusive with reps
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
  date?: Date;
}

export interface ApiWorkoutSet {
  setNumber: number;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
  durationSeconds: number | null;
}

export interface ApiWorkoutLog {
  exerciseId: string | null;
  exerciseName: string;
  order: number;
  rounds: number | null;
  workDurationSeconds: number | null;
  restDurationSeconds: number | null;
  intensity: number | null;
  distance: number | null;
  durationSeconds: number | null;
  pace: number | null;
  heartRate: number | null;
  durationMinutes: number | null;
  notes: string | null;
  sets: ApiWorkoutSet[];
}

export interface ApiWorkoutForEdit {
  workoutType: WorkoutFormData["workoutType"];
  notes: string | null;
  templateId: string | null;
  date: Date | string;
  logs: ApiWorkoutLog[];
}

export interface ApiTemplateExerciseForPrefill {
  exerciseId: string | null;
  order: number;
  defaultSets: number | null;
}

export interface ApiTemplateForWorkoutPrefill {
  id: string;
  workoutType: WorkoutFormData["workoutType"];
  notes: string | null;
  exercises: ApiTemplateExerciseForPrefill[];
}

export interface ExerciseProgressionSuggestion {
  type: string;
  details?: {
    currentValue: number;
    suggestedValue: number;
    unit: string;
  };
}

export function normalizeDateToLocalNoon(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    12,
    0,
    0,
    0,
  );
}

// Volume calculation (client-side)
export function calculateSetVolume(set: WorkoutSetFormData): number {
  if (set.durationSeconds !== undefined && set.reps === undefined) {
    return set.durationSeconds;
  }
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
    durationSeconds: undefined,
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
  const selectedDate = normalizeDateToLocalNoon(form.date ?? new Date());

  return {
    date: selectedDate,
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
        .filter((s) => s.reps !== undefined || s.weight !== undefined || s.durationSeconds !== undefined)
        .map((s) => ({
          setNumber: s.setNumber,
          reps: s.reps,
          weight: s.weight,
          rpe: s.rpe,
          durationSeconds: s.durationSeconds,
        })),
    })),
  };
}

export function apiWorkoutToFormData(workout: ApiWorkoutForEdit): WorkoutFormData {
  return {
    workoutType: workout.workoutType,
    notes: workout.notes ?? "",
    templateId: workout.templateId ?? undefined,
    date: workout.date instanceof Date ? workout.date : new Date(workout.date),
    exercises: workout.logs
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((log, index) => ({
        tempId: generateTempId(),
        exerciseId: log.exerciseId ?? undefined,
        exerciseName: log.exerciseName,
        order: index,
        sets:
          log.sets.length > 0
            ? log.sets.map((set) => ({
                tempId: generateTempId(),
                setNumber: set.setNumber,
                reps: set.reps ?? undefined,
                weight: set.weight ?? undefined,
                rpe: set.rpe ?? undefined,
                durationSeconds: set.durationSeconds ?? undefined,
              }))
            : [createBlankSet(1)],
        rounds: log.rounds ?? undefined,
        workDurationSeconds: log.workDurationSeconds ?? undefined,
        restDurationSeconds: log.restDurationSeconds ?? undefined,
        intensity: log.intensity ?? undefined,
        distance: log.distance ?? undefined,
        durationSeconds: log.durationSeconds ?? undefined,
        pace: log.pace ?? undefined,
        heartRate: log.heartRate ?? undefined,
        durationMinutes: log.durationMinutes ?? undefined,
        notes: log.notes ?? "",
      })),
  };
}

export function templateToWorkoutFormData(
  template: ApiTemplateForWorkoutPrefill,
  options?: {
    exerciseNameById?: Record<string, string>;
    suggestionsByExerciseId?: Record<string, ExerciseProgressionSuggestion | null>;
    date?: Date;
  },
): WorkoutFormData {
  const exerciseNameById = options?.exerciseNameById ?? {};
  const suggestionsByExerciseId = options?.suggestionsByExerciseId ?? {};

  return {
    workoutType: template.workoutType,
    notes: template.notes ?? "",
    templateId: template.id,
    date: options?.date ?? new Date(),
    exercises: template.exercises
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((exercise, index) => {
        const suggestion = exercise.exerciseId
          ? suggestionsByExerciseId[exercise.exerciseId]
          : null;
        const suggestedSets =
          suggestion?.details?.unit === "sets"
            ? Math.max(
                exercise.defaultSets ?? 1,
                Math.max(1, Math.round(suggestion.details.suggestedValue)),
              )
            : exercise.defaultSets ?? 1;
        const suggestedWeight =
          suggestion?.details &&
          (suggestion.details.unit === "lbs" || suggestion.details.unit === "kg")
            ? suggestion.details.suggestedValue
            : undefined;
        const suggestedReps =
          suggestion?.details?.unit === "reps"
            ? Math.max(1, Math.round(suggestion.details.suggestedValue))
            : undefined;
        const suggestedDuration =
          suggestion?.details?.unit === "s"
            ? Math.max(5, Math.round(suggestion.details.suggestedValue))
            : undefined;

        return {
          tempId: generateTempId(),
          exerciseId: exercise.exerciseId ?? undefined,
          exerciseName: exercise.exerciseId
            ? (exerciseNameById[exercise.exerciseId] ?? "Unknown Exercise")
            : "Custom Exercise",
          order: index,
          sets: Array.from({ length: suggestedSets }, (_, setIndex) => ({
            tempId: generateTempId(),
            setNumber: setIndex + 1,
            reps: suggestedReps,
            weight: suggestedWeight,
            rpe: undefined,
            durationSeconds: suggestedDuration,
          })),
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
      }),
  };
}

export function reconcileUnknownExerciseNames(
  form: WorkoutFormData,
  exerciseNameById: Record<string, string>,
): WorkoutFormData {
  let updated = false;
  const exercises = form.exercises.map((exercise) => {
    if (!exercise.exerciseId || exercise.exerciseName !== "Unknown Exercise") {
      return exercise;
    }
    const resolved = exerciseNameById[exercise.exerciseId];
    if (!resolved) return exercise;
    updated = true;
    return {
      ...exercise,
      exerciseName: resolved,
    };
  });

  if (!updated) return form;
  return {
    ...form,
    exercises,
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
