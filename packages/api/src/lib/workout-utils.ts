import { z } from "zod";
import { localDateToNoon } from "./date-utils";

// Cross-platform UUID generator for temporary IDs
function generateTempId(): string {
  // Use crypto.randomUUID if available (web), otherwise use timestamp + random
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for React Native
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

// Keep in sync with the pgEnum in packages/db/src/schema/enums.ts
export const WORKOUT_TYPE_ENUM = z.enum([
  "weightlifting",
  "hiit",
  "cardio",
  "mobility",
  "calisthenics",
  "yoga",
  "sports",
  "mixed",
]);

export type WorkoutType = z.infer<typeof WORKOUT_TYPE_ENUM>;
export type ExerciseType = WorkoutType;

export const CARDIO_EXERCISE_TYPES = ["cardio", "hiit", "mobility"] as const;

interface ExerciseFieldConfig {
  hasSets: boolean;
  hasRounds: boolean;
  hasWorkRestDuration: boolean;
  hasDistance: boolean;
  hasDurationSeconds: boolean;
  hasDurationMinutes: boolean;
  hasIntensity: boolean;
  hasHeartRate: boolean;
}

const EXERCISE_TYPE_FIELD_CONFIG: Record<ExerciseType, ExerciseFieldConfig> = {
  weightlifting: {
    hasSets: true,
    hasRounds: false,
    hasWorkRestDuration: false,
    hasDistance: false,
    hasDurationSeconds: false,
    hasDurationMinutes: true,
    hasIntensity: false,
    hasHeartRate: false,
  },
  hiit: {
    hasSets: false,
    hasRounds: true,
    hasWorkRestDuration: true,
    hasDistance: false,
    hasDurationSeconds: false,
    hasDurationMinutes: false,
    hasIntensity: true,
    hasHeartRate: false,
  },
  cardio: {
    hasSets: false,
    hasRounds: false,
    hasWorkRestDuration: false,
    hasDistance: true,
    hasDurationSeconds: true,
    hasDurationMinutes: false,
    hasIntensity: true,
    hasHeartRate: true,
  },
  mobility: {
    hasSets: false,
    hasRounds: true,
    hasWorkRestDuration: false,
    hasDistance: false,
    hasDurationSeconds: true,
    hasDurationMinutes: false,
    hasIntensity: false,
    hasHeartRate: false,
  },
  calisthenics: {
    hasSets: true,
    hasRounds: false,
    hasWorkRestDuration: false,
    hasDistance: false,
    hasDurationSeconds: false,
    hasDurationMinutes: true,
    hasIntensity: false,
    hasHeartRate: false,
  },
  yoga: {
    hasSets: true,
    hasRounds: false,
    hasWorkRestDuration: false,
    hasDistance: false,
    hasDurationSeconds: false,
    hasDurationMinutes: true,
    hasIntensity: false,
    hasHeartRate: false,
  },
  sports: {
    hasSets: true,
    hasRounds: false,
    hasWorkRestDuration: false,
    hasDistance: false,
    hasDurationSeconds: false,
    hasDurationMinutes: true,
    hasIntensity: false,
    hasHeartRate: false,
  },
  mixed: {
    hasSets: true,
    hasRounds: false,
    hasWorkRestDuration: false,
    hasDistance: false,
    hasDurationSeconds: false,
    hasDurationMinutes: true,
    hasIntensity: false,
    hasHeartRate: false,
  },
};

export function getEffectiveDurationSeconds(log: {
  durationSeconds?: number | null;
  durationMinutes?: number | null;
}): number | null {
  if (log.durationSeconds != null) return log.durationSeconds;
  if (log.durationMinutes != null) return log.durationMinutes * 60;
  return null;
}

export function isCardioStyleExerciseType(
  exerciseType: string | undefined,
): exerciseType is (typeof CARDIO_EXERCISE_TYPES)[number] {
  return CARDIO_EXERCISE_TYPES.includes(
    exerciseType as (typeof CARDIO_EXERCISE_TYPES)[number],
  );
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

export type CardioSubtype =
  | "running"
  | "cycling"
  | "swimming"
  | "rowing"
  | "other";

export interface WorkoutExerciseFormData {
  tempId: string;
  exerciseId: string | undefined;
  exerciseName: string;
  exerciseType: ExerciseType | undefined;
  cardioSubtype?: CardioSubtype | null;
  order: number;
  sets: WorkoutSetFormData[];
  // HIIT fields
  rounds: number | undefined;
  workDurationSeconds: number | undefined;
  restDurationSeconds: number | undefined;
  intensity: number | undefined;
  // Cardio fields — distance stored as meters
  distanceMeter: number | undefined;
  durationSeconds: number | undefined;
  heartRate: number | undefined;
  // Yoga/Sports
  durationMinutes: number | undefined;
  notes: string;
}

export interface WorkoutFormData {
  workoutType: WorkoutType;
  exercises: WorkoutExerciseFormData[];
  notes: string;
  templateId: string | undefined;
  date?: Date;
  whoopActivityId?: string | null;
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
  exercise?: {
    exerciseType: ExerciseType;
    cardioSubtype?: CardioSubtype | null;
  } | null;
  order: number;
  rounds: number | null;
  workDurationSeconds: number | null;
  restDurationSeconds: number | null;
  intensity: number | null;
  distanceMeter: number | null;
  durationSeconds: number | null;
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
  exercise?: { name: string; exerciseType: ExerciseType } | null;
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
  if (isCardioStyleExerciseType(exercise.exerciseType)) {
    return 0;
  }
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

/**
 * Strength training volume for a workout's exercise logs, used by the import /
 * sync write paths (TCX, Whoop, workouts.update) and the totalVolume backfill
 * migration to populate `workout.totalVolume`.
 *
 * Volume = sum of `weight * reps` across every set that has BOTH weight and reps
 * non-null. Returns `null` (not 0) when there are no qualifying weighted sets —
 * matching the markdown importer's `totalVolume > 0 ? totalVolume : null`
 * convention so cardio/run/Whoop workouts stay NULL rather than charting as 0.
 *
 * Note: this is deliberately the strength definition (weight * reps only); unlike
 * the form-layer `calculateTotalVolume`, duration-based sets do not contribute.
 */
export function computeWorkoutTotalVolume(
  logs:
    | {
        sets?: { weight?: number | null; reps?: number | null }[] | null;
      }[]
    | null
    | undefined,
): number | null {
  if (!logs) return null;
  let total = 0;
  for (const log of logs) {
    for (const set of log.sets ?? []) {
      if (set.weight != null && set.reps != null) {
        total += set.weight * set.reps;
      }
    }
  }
  return total > 0 ? total : null;
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
    exerciseType: undefined,
    cardioSubtype: undefined,
    order,
    sets: [createBlankSet(1)],
    rounds: undefined,
    workDurationSeconds: undefined,
    restDurationSeconds: undefined,
    intensity: undefined,
    distanceMeter: undefined,
    durationSeconds: undefined,
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
  const selectedDate = localDateToNoon(form.date ?? new Date());

  return {
    date: selectedDate,
    workoutType: form.workoutType,
    notes: form.notes || undefined,
    templateId: form.templateId,
    totalVolume: totalVolume > 0 ? totalVolume : undefined,
    whoopActivityId: form.whoopActivityId ?? undefined,
    logs: exercises.map((ex, idx) => {
      const cfg =
        EXERCISE_TYPE_FIELD_CONFIG[ex.exerciseType ?? "weightlifting"] ??
        EXERCISE_TYPE_FIELD_CONFIG["weightlifting"];

      return {
        ...(ex.exerciseId ? { exerciseId: ex.exerciseId } : {}),
        exerciseName: ex.exerciseName,
        order: idx,
        rounds: cfg.hasRounds ? ex.rounds : undefined,
        workDurationSeconds: cfg.hasWorkRestDuration
          ? ex.workDurationSeconds
          : undefined,
        restDurationSeconds: cfg.hasWorkRestDuration
          ? ex.restDurationSeconds
          : undefined,
        intensity: cfg.hasIntensity ? ex.intensity : undefined,
        distanceMeter: cfg.hasDistance ? ex.distanceMeter : undefined,
        durationSeconds: cfg.hasDurationSeconds
          ? ex.durationSeconds
          : undefined,
        heartRate: cfg.hasHeartRate ? ex.heartRate : undefined,
        durationMinutes: cfg.hasDurationMinutes
          ? ex.durationMinutes
          : undefined,
        notes: ex.notes || undefined,
        sets: cfg.hasSets
          ? ex.sets
              .filter(
                (s) =>
                  s.reps !== undefined ||
                  s.weight !== undefined ||
                  s.durationSeconds !== undefined,
              )
              .map((s) => ({
                setNumber: s.setNumber,
                reps: s.reps,
                weight: s.weight,
                rpe: s.rpe,
                durationSeconds: s.durationSeconds,
              }))
          : [],
      };
    }),
  };
}

export function apiWorkoutToFormData(
  workout: ApiWorkoutForEdit,
): WorkoutFormData {
  return {
    workoutType: workout.workoutType,
    notes: workout.notes ?? "",
    templateId: workout.templateId ?? undefined,
    date: workout.date instanceof Date ? workout.date : new Date(workout.date),
    exercises: workout.logs
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((log, index) => {
        const exerciseType = log.exercise?.exerciseType ?? undefined;
        const shouldCreateBlankSet =
          log.sets.length === 0 && !isCardioStyleExerciseType(exerciseType);

        return {
          tempId: generateTempId(),
          exerciseId: log.exerciseId ?? undefined,
          exerciseName: log.exerciseName,
          exerciseType,
          cardioSubtype: log.exercise?.cardioSubtype ?? undefined,
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
              : shouldCreateBlankSet
                ? [createBlankSet(1)]
                : [],
          rounds: log.rounds ?? undefined,
          workDurationSeconds: log.workDurationSeconds ?? undefined,
          restDurationSeconds: log.restDurationSeconds ?? undefined,
          intensity: log.intensity ?? undefined,
          distanceMeter: log.distanceMeter ?? undefined,
          durationSeconds: log.durationSeconds ?? undefined,
          heartRate: log.heartRate ?? undefined,
          durationMinutes: log.durationMinutes ?? undefined,
          notes: log.notes ?? "",
        };
      }),
  };
}

export function templateToWorkoutFormData(
  template: ApiTemplateForWorkoutPrefill,
  options?: {
    exerciseNameById?: Record<string, string>;
    exerciseTypeById?: Record<string, ExerciseType>;
    suggestionsByExerciseId?: Record<
      string,
      ExerciseProgressionSuggestion | null
    >;
    date?: Date;
  },
): WorkoutFormData {
  const exerciseNameById = options?.exerciseNameById ?? {};
  const exerciseTypeById = options?.exerciseTypeById ?? {};
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
        const exerciseType =
          exercise.exercise?.exerciseType ??
          (exercise.exerciseId
            ? exerciseTypeById[exercise.exerciseId]
            : undefined);
        const cfg =
          EXERCISE_TYPE_FIELD_CONFIG[exerciseType ?? "weightlifting"] ??
          EXERCISE_TYPE_FIELD_CONFIG["weightlifting"];
        const suggestion = exercise.exerciseId
          ? suggestionsByExerciseId[exercise.exerciseId]
          : null;
        const suggestedSets =
          suggestion?.details?.unit === "sets"
            ? Math.max(
                exercise.defaultSets ?? 1,
                Math.max(1, Math.round(suggestion.details.suggestedValue)),
              )
            : (exercise.defaultSets ?? 1);
        const suggestedWeight =
          suggestion?.details &&
          (suggestion.details.unit === "lbs" ||
            suggestion.details.unit === "kg")
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
          exerciseName:
            exercise.exercise?.name ??
            (exercise.exerciseId
              ? (exerciseNameById[exercise.exerciseId] ?? "Unknown Exercise")
              : "Custom Exercise"),
          exerciseType,
          cardioSubtype: undefined,
          order: index,
          sets: cfg.hasSets
            ? Array.from({ length: suggestedSets }, (_, setIndex) => ({
                tempId: generateTempId(),
                setNumber: setIndex + 1,
                reps: suggestedReps,
                weight: suggestedWeight,
                rpe: undefined,
                durationSeconds: suggestedDuration,
              }))
            : [],
          rounds: undefined,
          workDurationSeconds: undefined,
          restDurationSeconds: undefined,
          intensity: undefined,
          distanceMeter: undefined,
          durationSeconds: undefined,
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
  mobility: "Mobility",
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

// ── Distance conversion helpers ─────────────────────────────────────────────

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;

/**
 * Convert meters to the user's preferred distance unit.
 * Returns the numeric value (not formatted).
 */
export function metersToDisplayUnit(meters: number, unit: "mi" | "km"): number {
  return unit === "mi" ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

/**
 * Convert from the user's preferred distance unit back to meters.
 */
export function displayUnitToMeters(value: number, unit: "mi" | "km"): number {
  return unit === "mi" ? value * METERS_PER_MILE : value * METERS_PER_KM;
}

/**
 * Format a distance for display (1 decimal place).
 * Example: formatDistance(8046.72, "mi") → "5.0 mi"
 */
export function formatDistance(meters: number, unit: "mi" | "km"): string {
  const value = metersToDisplayUnit(meters, unit);
  return `${value.toFixed(1)} ${unit}`;
}

/**
 * Derive pace from distanceMeter and durationSeconds.
 * Returns pace in min/unit as a formatted string, e.g. "8:30 /mi".
 * Returns null if inputs are missing or zero.
 */
export function derivePace(
  distanceMeter: number | null | undefined,
  durationSeconds: number | null | undefined,
  unit: "mi" | "km",
): string | null {
  if (!distanceMeter || !durationSeconds || durationSeconds <= 0) return null;
  const displayDist = metersToDisplayUnit(distanceMeter, unit);
  if (displayDist <= 0) return null;
  const paceSecondsPerUnit = durationSeconds / displayDist;
  const paceMinutes = Math.floor(paceSecondsPerUnit / 60);
  const paceSeconds = Math.round(paceSecondsPerUnit % 60);
  const secondsStr = paceSeconds.toString().padStart(2, "0");
  return `${paceMinutes}:${secondsStr} /${unit}`;
}

// ── End distance helpers ─────────────────────────────────────────────────────

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
