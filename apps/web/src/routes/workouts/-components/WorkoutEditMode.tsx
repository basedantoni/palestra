import { useMutation, useQueryClient } from "@tanstack/react-query";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";

import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ExercisePicker } from "@/components/workout/exercise-picker";
import { ExerciseCard } from "@/components/workout/exercise-card";
import {
  apiWorkoutToFormData,
  type ExerciseType,
  formatVolume,
  WORKOUT_TYPE_LABELS,
  calculateTotalVolume,
  createBlankExercise,
  formDataToApiInput,
} from "@src/api/lib/index";
import type { WorkoutFormData } from "@src/api/lib/index";

export interface WorkoutEditModeHandle {
  save: () => void;
  cancel: () => void;
  isPending: boolean;
}

interface WorkoutEditModeProps {
  workout: any; // Raw workout from the API query
  workoutId: string;
  distanceUnit: "mi" | "km";
  onSaved: () => void;
  onCancel: () => void;
  /** Called whenever isPending changes so the parent can update its button state */
  onPendingChange?: (isPending: boolean) => void;
}

export const WorkoutEditMode = forwardRef<
  WorkoutEditModeHandle,
  WorkoutEditModeProps
>(function WorkoutEditMode(
  { workout, workoutId, distanceUnit, onSaved, onCancel, onPendingChange },
  ref,
) {
  const queryClient = useQueryClient();
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [editingExerciseIndex, setEditingExerciseIndex] = useState<
    number | null
  >(null);
  const [formData, setFormData] = useState<WorkoutFormData | null>(
    () => apiWorkoutToFormData(workout),
  );

  // Re-sync if the workout prop changes (e.g., after a refetch)
  useEffect(() => {
    setFormData(apiWorkoutToFormData(workout));
  }, [workout]);

  const updateWorkout = useMutation(
    trpc.workouts.update.mutationOptions({
      onSuccess: async () => {
        toast.success("Workout updated");
        await queryClient.invalidateQueries();
        onSaved();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update workout");
      },
    }),
  );

  // Notify parent of pending state changes
  useEffect(() => {
    onPendingChange?.(updateWorkout.isPending);
  }, [updateWorkout.isPending, onPendingChange]);

  const handleSave = () => {
    if (!formData) return;
    const payload = formDataToApiInput(formData);
    updateWorkout.mutate({ id: workoutId, ...payload });
  };

  const handleCancel = () => {
    setFormData(apiWorkoutToFormData(workout));
    onCancel();
  };

  useImperativeHandle(ref, () => ({
    save: handleSave,
    cancel: handleCancel,
    isPending: updateWorkout.isPending,
  }));

  const handleAddExercise = () => {
    if (!formData) return;
    setEditingExerciseIndex(formData.exercises.length);
    setShowExercisePicker(true);
  };

  const handleChangeExercise = (index: number) => {
    setEditingExerciseIndex(index);
    setShowExercisePicker(true);
  };

  const handleSelectExercise = (exercise: {
    id: string;
    name: string;
    exerciseType?: string;
  }) => {
    if (!formData || editingExerciseIndex === null) return;

    const updatedExercises = [...formData.exercises];
    if (editingExerciseIndex >= updatedExercises.length) {
      updatedExercises.push({
        ...createBlankExercise(updatedExercises.length),
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        exerciseType: exercise.exerciseType as ExerciseType | undefined,
      });
    } else {
      updatedExercises[editingExerciseIndex] = {
        ...updatedExercises[editingExerciseIndex],
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        exerciseType: exercise.exerciseType as ExerciseType | undefined,
      };
    }

    setFormData({ ...formData, exercises: updatedExercises });
  };

  const handleUpdateExercise = (
    index: number,
    updated: WorkoutFormData["exercises"][0],
  ) => {
    if (!formData) return;
    const updatedExercises = [...formData.exercises];
    updatedExercises[index] = updated;
    setFormData({ ...formData, exercises: updatedExercises });
  };

  const handleRemoveExercise = (index: number) => {
    if (!formData) return;
    const updatedExercises = formData.exercises
      .filter((_, i) => i !== index)
      .map((ex, i) => ({ ...ex, order: i }));
    setFormData({ ...formData, exercises: updatedExercises });
  };

  if (!formData) return null;

  return (
    <>
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="workout-type">Workout Type</Label>
          <select
            id="workout-type"
            className="mt-2 w-full rounded border bg-background px-3 py-2 text-sm"
            value={formData.workoutType}
            onChange={(e) =>
              setFormData({
                ...formData,
                workoutType: e.target.value as WorkoutFormData["workoutType"],
              })
            }
          >
            {Object.entries(WORKOUT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="workout-date">Date</Label>
          <input
            id="workout-date"
            type="date"
            className="mt-2 w-full rounded border bg-background px-3 py-2 text-sm"
            value={format(formData.date ?? new Date(), "yyyy-MM-dd")}
            onChange={(e) => {
              const nextDate = new Date(`${e.target.value}T12:00:00`);
              if (!Number.isNaN(nextDate.getTime())) {
                setFormData({ ...formData, date: nextDate });
              }
            }}
          />
        </div>
      </div>

      <Separator className="my-6" />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Exercises</h2>
          {calculateTotalVolume(formData.exercises) > 0 && (
            <div className="text-sm text-muted-foreground">
              Total Volume:{" "}
              {formatVolume(calculateTotalVolume(formData.exercises))}
            </div>
          )}
        </div>

        {formData.exercises.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No exercises added yet
          </div>
        ) : (
          <div className="space-y-4">
            {formData.exercises.map((exercise, index) => (
              <ExerciseCard
                key={exercise.tempId}
                exercise={exercise}
                distanceUnit={distanceUnit}
                onUpdate={(updated) => handleUpdateExercise(index, updated)}
                onRemove={() => handleRemoveExercise(index)}
                onChangeExercise={() => handleChangeExercise(index)}
              />
            ))}
          </div>
        )}

        <Button
          onClick={handleAddExercise}
          variant="outline"
          className="w-full"
        >
          Add Exercise
        </Button>
      </div>

      <div className="mt-6">
        <Label htmlFor="notes">Notes (optional)</Label>
        <textarea
          id="notes"
          className="mt-2 w-full rounded border bg-background px-3 py-2 text-sm"
          rows={3}
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
        />
      </div>

      <ExercisePicker
        open={showExercisePicker}
        onOpenChange={setShowExercisePicker}
        onSelect={handleSelectExercise}
      />
    </>
  );
});
