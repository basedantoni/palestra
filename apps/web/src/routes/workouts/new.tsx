import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { CalendarIcon, Plus } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ExercisePicker } from "@/components/workout/exercise-picker";
import { ExerciseCard } from "@/components/workout/exercise-card";
import { cn } from "@/lib/utils";
import {
  createBlankExercise,
  formDataToApiInput,
  calculateTotalVolume,
  formatVolume,
  WORKOUT_TYPE_LABELS,
} from "@src/api/lib/index";
import type { WorkoutFormData } from "@src/api/lib/index";

export const Route = createFileRoute("/workouts/new")({
  component: RouteComponent,
  beforeLoad: async ({ context }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }

    const isComplete = await context.queryClient.fetchQuery(
      context.trpc.preferences.isOnboardingComplete.queryOptions(),
    );

    if (!isComplete) {
      redirect({ to: "/onboarding", throw: true });
    }

    return { session };
  },
});

function RouteComponent() {
  const navigate = useNavigate();
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [editingExerciseIndex, setEditingExerciseIndex] = useState<
    number | null
  >(null);

  const [formData, setFormData] = useState<WorkoutFormData>({
    workoutType: "weightlifting",
    exercises: [],
    notes: "",
    templateId: undefined,
    date: new Date(),
  });

  const createWorkout = useMutation(
    trpc.workouts.create.mutationOptions({
      onSuccess: (data) => {
        navigate({ to: "/workouts/$workoutId", params: { workoutId: data.id } });
      },
    }),
  );

  const handleAddExercise = () => {
    setEditingExerciseIndex(formData.exercises.length);
    setShowExercisePicker(true);
  };

  const handleChangeExercise = (index: number) => {
    setEditingExerciseIndex(index);
    setShowExercisePicker(true);
  };

  const handleSelectExercise = (exercise: { id: string; name: string }) => {
    if (editingExerciseIndex !== null) {
      const updatedExercises = [...formData.exercises];
      if (editingExerciseIndex >= updatedExercises.length) {
        // Adding new exercise
        updatedExercises.push({
          ...createBlankExercise(updatedExercises.length),
          exerciseId: exercise.id,
          exerciseName: exercise.name,
        });
      } else {
        // Changing existing exercise
        updatedExercises[editingExerciseIndex] = {
          ...updatedExercises[editingExerciseIndex],
          exerciseId: exercise.id,
          exerciseName: exercise.name,
        };
      }
      setFormData({ ...formData, exercises: updatedExercises });
    }
  };

  const handleUpdateExercise = (
    index: number,
    updated: WorkoutFormData["exercises"][0],
  ) => {
    const updatedExercises = [...formData.exercises];
    updatedExercises[index] = updated;
    setFormData({ ...formData, exercises: updatedExercises });
  };

  const handleRemoveExercise = (index: number) => {
    const updatedExercises = formData.exercises
      .filter((_, i) => i !== index)
      .map((ex, i) => ({ ...ex, order: i }));
    setFormData({ ...formData, exercises: updatedExercises });
  };

  const handleSave = () => {
    const apiInput = formDataToApiInput(formData);
    createWorkout.mutate(apiInput);
  };

  const totalVolume = calculateTotalVolume(formData.exercises);
  const canSave =
    formData.exercises.length > 0 &&
    formData.exercises.every((ex) => ex.exerciseName.trim() !== "");

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">New Workout</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate({ to: "/dashboard" })}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSave || createWorkout.isPending}
          >
            {createWorkout.isPending ? "Saving..." : "Save Workout"}
          </Button>
        </div>
      </div>

      {/* Workout Type Selector */}
      <div className="mb-6">
        <Label htmlFor="workout-type">Workout Type</Label>
        <Select
          value={formData.workoutType}
          onValueChange={(value) =>
            setFormData({
              ...formData,
              workoutType: value as WorkoutFormData["workoutType"],
            })
          }
        >
          <SelectTrigger id="workout-type" className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(WORKOUT_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Workout Date */}
      <div className="mb-6">
        <Label>Date</Label>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                className={cn(
                  "w-[200px] justify-start text-left font-normal mt-1",
                  !formData.date && "text-muted-foreground",
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {formData.date ? format(formData.date, "PPP") : "Pick a date"}
              </Button>
            }
          />
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={formData.date}
              onSelect={(date) => {
                if (date) setFormData({ ...formData, date });
              }}
              disabled={(date) => date > new Date()}
              autoFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      <Separator className="my-6" />

      {/* Exercises */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Exercises</h2>
          {totalVolume > 0 && (
            <div className="text-sm text-muted-foreground">
              Total Volume: {formatVolume(totalVolume)}
            </div>
          )}
        </div>

        {formData.exercises.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <p>No exercises added yet</p>
            <p className="mt-1 text-sm">Click "Add Exercise" to get started</p>
          </div>
        ) : (
          <div className="space-y-4">
            {formData.exercises.map((exercise, index) => (
              <ExerciseCard
                key={exercise.tempId}
                exercise={exercise}
                onUpdate={(updated) => handleUpdateExercise(index, updated)}
                onRemove={() => handleRemoveExercise(index)}
                onChangeExercise={() => handleChangeExercise(index)}
              />
            ))}
          </div>
        )}

        <Button onClick={handleAddExercise} variant="outline" className="w-full">
          <Plus className="h-4 w-4" />
          Add Exercise
        </Button>
      </div>

      {/* Notes */}
      <div className="mt-6">
        <Label htmlFor="notes">Notes (optional)</Label>
        <textarea
          id="notes"
          className="mt-2 w-full rounded border bg-background px-3 py-2 text-sm"
          rows={3}
          placeholder="Add any notes about this workout..."
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
        />
      </div>

      {/* Exercise Picker Dialog */}
      <ExercisePicker
        open={showExercisePicker}
        onOpenChange={setShowExercisePicker}
        onSelect={handleSelectExercise}
      />
    </div>
  );
}
