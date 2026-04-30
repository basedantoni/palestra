import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { CalendarIcon, Plus } from "lucide-react";
import { z } from "zod";

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
import { WhoopLinkCard } from "@/components/workout/whoop-link-card";
import { cn } from "@/lib/utils";
import {
  createBlankExercise,
  formDataToApiInput,
  calculateTotalVolume,
  type ExerciseType,
  type CardioSubtype,
  formatVolume,
  normalizeDateToLocalNoon,
  reconcileUnknownExerciseNames,
  templateToWorkoutFormData,
  WORKOUT_TYPE_LABELS,
} from "@src/api/lib/index";
import type { WorkoutFormData } from "@src/api/lib/index";

export const Route = createFileRoute("/workouts/new")({
  validateSearch: z.object({
    templateId: z.string().optional(),
  }),
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
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [editingExerciseIndex, setEditingExerciseIndex] = useState<
    number | null
  >(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(
    search.templateId,
  );
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | undefined>();

  // Whoop linking state
  const [selectedWhoopActivityId, setSelectedWhoopActivityId] = useState<string | null>(null);
  const [whoopCardOpen, setWhoopCardOpen] = useState(false);

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

  const templatesQuery = useQuery(trpc.templates.list.queryOptions());
  const templateQuery = useQuery(
    trpc.templates.get.queryOptions(
      { id: selectedTemplateId! },
      { enabled: !!selectedTemplateId },
    ),
  );
  const exercisesQuery = useQuery(trpc.exercises.list.queryOptions());
  const overloadQuery = useQuery(trpc.analytics.progressiveOverload.queryOptions());
  const preferencesQuery = useQuery(trpc.preferences.get.queryOptions());
  const distanceUnit = preferencesQuery.data?.distanceUnit ?? "mi";

  const exerciseNameById = useMemo(() => {
    return Object.fromEntries(
      (exercisesQuery.data ?? []).map((exercise) => [exercise.id, exercise.name]),
    );
  }, [exercisesQuery.data]);

  const exerciseTypeById = useMemo(() => {
    return Object.fromEntries(
      (exercisesQuery.data ?? []).map((exercise) => [
        exercise.id,
        exercise.exerciseType as ExerciseType,
      ]),
    );
  }, [exercisesQuery.data]);

  const suggestionsByExerciseId = useMemo(() => {
    const pairs = (overloadQuery.data ?? []).map((item) => [item.exerciseId, item.suggestion]);
    return Object.fromEntries(pairs);
  }, [overloadQuery.data]);

  // Detect whether any exercise in the form has cardioSubtype === 'running'
  const hasRunningExercise = formData.exercises.some(
    (ex) => ex.cardioSubtype === "running",
  );

  // Clear Whoop selection when no running exercise is present
  useEffect(() => {
    if (!hasRunningExercise && selectedWhoopActivityId !== null) {
      setSelectedWhoopActivityId(null);
      setWhoopCardOpen(false);
    }
  }, [hasRunningExercise, selectedWhoopActivityId]);

  // ISO date string for the Whoop picker (YYYY-MM-DD)
  const workoutDateIso = formData.date
    ? format(formData.date, "yyyy-MM-dd")
    : format(new Date(), "yyyy-MM-dd");

  // Reset Whoop selection when workout date changes
  const prevWorkoutDateRef = useRef(workoutDateIso);
  useEffect(() => {
    if (prevWorkoutDateRef.current !== workoutDateIso) {
      prevWorkoutDateRef.current = workoutDateIso;
      setSelectedWhoopActivityId(null);
    }
  }, [workoutDateIso]);

  // Fetch selected Whoop activity detail for summary display
  const whoopActivitiesQuery = useQuery(
    trpc.whoop.listUnlinkedCardioActivities.queryOptions(
      { date: workoutDateIso },
      { enabled: hasRunningExercise && whoopCardOpen },
    ),
  );
  const selectedWhoopActivity = useMemo(() => {
    if (!selectedWhoopActivityId) return null;
    return (
      whoopActivitiesQuery.data?.activities.find(
        (a) => a.id === selectedWhoopActivityId,
      ) ?? null
    );
  }, [selectedWhoopActivityId, whoopActivitiesQuery.data]);

  useEffect(() => {
    if (!selectedTemplateId || !templateQuery.data) return;
    if (appliedTemplateId === selectedTemplateId) return;
    setFormData(
      templateToWorkoutFormData(templateQuery.data as any, {
        exerciseNameById,
        exerciseTypeById,
        suggestionsByExerciseId,
        date: new Date(),
      }),
    );
    setAppliedTemplateId(selectedTemplateId);
  }, [
    appliedTemplateId,
    selectedTemplateId,
    templateQuery.data,
    exerciseNameById,
    exerciseTypeById,
    suggestionsByExerciseId,
  ]);

  useEffect(() => {
    if (!Object.keys(exerciseNameById).length) return;
    setFormData((prev) => reconcileUnknownExerciseNames(prev, exerciseNameById));
  }, [exerciseNameById]);

  const handleAddExercise = () => {
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
    cardioSubtype?: string | null;
  }) => {
    if (editingExerciseIndex !== null) {
      const updatedExercises = [...formData.exercises];
      if (editingExerciseIndex >= updatedExercises.length) {
        // Adding new exercise
        updatedExercises.push({
          ...createBlankExercise(updatedExercises.length),
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          exerciseType: exercise.exerciseType as ExerciseType | undefined,
          cardioSubtype: exercise.cardioSubtype as CardioSubtype | undefined,
        });
      } else {
        // Changing existing exercise — clear Whoop if running subtype changes
        const prevSubtype = updatedExercises[editingExerciseIndex]?.cardioSubtype;
        updatedExercises[editingExerciseIndex] = {
          ...updatedExercises[editingExerciseIndex]!,
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          exerciseType: exercise.exerciseType as ExerciseType | undefined,
          cardioSubtype: exercise.cardioSubtype as CardioSubtype | undefined,
        };
        if (prevSubtype === "running" && exercise.cardioSubtype !== "running") {
          // Check if any other exercise is still running
          const stillHasRunning = updatedExercises.some(
            (ex, i) => i !== editingExerciseIndex && ex.cardioSubtype === "running",
          );
          if (!stillHasRunning) {
            setSelectedWhoopActivityId(null);
            setWhoopCardOpen(false);
          }
        }
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
    const removedExercise = formData.exercises[index];
    const updatedExercises = formData.exercises
      .filter((_, i) => i !== index)
      .map((ex, i) => ({ ...ex, order: i }));

    // Clear Whoop if the removed exercise was running and no others are running
    if (removedExercise?.cardioSubtype === "running") {
      const stillHasRunning = updatedExercises.some(
        (ex) => ex.cardioSubtype === "running",
      );
      if (!stillHasRunning) {
        setSelectedWhoopActivityId(null);
        setWhoopCardOpen(false);
      }
    }

    setFormData({ ...formData, exercises: updatedExercises });
  };

  const handleSave = () => {
    const apiInput = formDataToApiInput({
      ...formData,
      whoopActivityId: selectedWhoopActivityId ?? undefined,
    });
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
        <Label htmlFor="template">Template</Label>
        <Select
          value={selectedTemplateId ?? "__none__"}
          onValueChange={(value) => {
            const nextTemplateId =
              !value || value === "__none__" ? undefined : value;
            setSelectedTemplateId(nextTemplateId);
            if (!nextTemplateId) {
              setAppliedTemplateId(undefined);
              setFormData((prev) => ({
                ...prev,
                templateId: undefined,
              }));
            }
          }}
        >
          <SelectTrigger id="template" className="w-[280px] mt-1 mb-4">
            <SelectValue placeholder="Start from template (optional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No Template</SelectItem>
            {(templatesQuery.data ?? []).map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
                if (date) {
                  setFormData({
                    ...formData,
                    date: normalizeDateToLocalNoon(date),
                  });
                }
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
                distanceUnit={distanceUnit}
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

      {/* Whoop Linking Card — only visible when a running exercise is present */}
      {hasRunningExercise && (
        <WhoopLinkCard
          workoutDate={workoutDateIso}
          selectedActivityId={selectedWhoopActivityId}
          selectedActivity={selectedWhoopActivity}
          isOpen={whoopCardOpen}
          distanceUnit={distanceUnit}
          onToggle={() => setWhoopCardOpen((open) => !open)}
          onSelect={setSelectedWhoopActivityId}
        />
      )}

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
