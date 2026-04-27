// Cross-platform UUID generator for temporary IDs
function generateTempId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export interface TemplateExerciseFormData {
  tempId: string;
  exerciseId: string | undefined;
  exerciseName: string;
  order: number;
  defaultSets: number | undefined;
}

export interface TemplateFormData {
  name: string;
  workoutType:
    | "weightlifting"
    | "hiit"
    | "cardio"
    | "mobility"
    | "calisthenics"
    | "yoga"
    | "sports"
    | "mixed";
  notes: string;
  exercises: TemplateExerciseFormData[];
}

export interface ApiTemplateExerciseForEdit {
  exerciseId: string | null;
  order: number;
  defaultSets: number | null;
}

export interface ApiTemplateForEdit {
  name: string;
  workoutType: TemplateFormData["workoutType"];
  notes: string | null;
  exercises: ApiTemplateExerciseForEdit[];
}

export function apiTemplateToFormData(
  template: ApiTemplateForEdit,
  exerciseNameById: Record<string, string> = {},
): TemplateFormData {
  return {
    name: template.name,
    workoutType: template.workoutType,
    notes: template.notes ?? "",
    exercises: template.exercises
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((exercise, index) => ({
        tempId: generateTempId(),
        exerciseId: exercise.exerciseId ?? undefined,
        exerciseName: exercise.exerciseId
          ? (exerciseNameById[exercise.exerciseId] ?? "Unknown Exercise")
          : "Custom Exercise",
        order: index,
        defaultSets: exercise.defaultSets ?? undefined,
      })),
  };
}

export function templateFormToApiInput(form: TemplateFormData) {
  return {
    name: form.name,
    workoutType: form.workoutType,
    notes: form.notes || undefined,
    exercises: form.exercises.map((exercise, index) => ({
      ...(exercise.exerciseId ? { exerciseId: exercise.exerciseId } : {}),
      order: index,
      defaultSets: exercise.defaultSets,
    })),
  };
}
