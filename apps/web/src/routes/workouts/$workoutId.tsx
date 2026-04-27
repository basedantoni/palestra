import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Calendar, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
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

export const Route = createFileRoute("/workouts/$workoutId")({
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
  const { workoutId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [editingExerciseIndex, setEditingExerciseIndex] = useState<number | null>(
    null,
  );
  const [formData, setFormData] = useState<WorkoutFormData | null>(null);

  const { data: workout, isLoading, refetch } = useQuery(
    trpc.workouts.get.queryOptions({ id: workoutId }),
  );

  useEffect(() => {
    if (workout) {
      setFormData(apiWorkoutToFormData(workout as any));
    }
  }, [workout]);

  const deleteWorkout = useMutation(
    trpc.workouts.delete.mutationOptions({
      onSuccess: () => {
        navigate({ to: "/workouts" });
      },
    }),
  );

  const updateWorkout = useMutation(
    trpc.workouts.update.mutationOptions({
      onSuccess: async () => {
        setIsEditing(false);
        toast.success("Workout updated");
        await queryClient.invalidateQueries();
        await refetch();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update workout");
      },
    }),
  );

  const saveAsTemplate = useMutation(
    trpc.workouts.saveAsTemplate.mutationOptions({
      onSuccess: () => {
        alert("Workout saved as template!");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save workout as template");
      },
    }),
  );

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="text-center text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!workout) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="text-center text-muted-foreground">Workout not found</div>
      </div>
    );
  }

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this workout?")) {
      deleteWorkout.mutate({ id: workoutId });
    }
  };

  const handleSaveAsTemplate = () => {
    const name = prompt("Enter template name:");
    const trimmedName = name?.trim();
    if (trimmedName) {
      saveAsTemplate.mutate({ workoutId, name: trimmedName });
    }
  };

  const handleStartEdit = () => {
    if (!workout) return;
    setFormData(apiWorkoutToFormData(workout as any));
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    if (workout) {
      setFormData(apiWorkoutToFormData(workout as any));
    }
    setIsEditing(false);
  };

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

  const handleSaveEdit = () => {
    if (!formData) return;
    const payload = formDataToApiInput(formData);
    updateWorkout.mutate({
      id: workoutId,
      ...payload,
    });
  };

  const formatLoggedDuration = (seconds: number | null) => {
    if (seconds == null) return "-";
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
  };

  const formatLoggedPace = (pace: number | null) => {
    if (pace == null) return "-";
    return `${pace.toFixed(2)} min/unit`;
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Workout Details</h1>
            <Badge>{WORKOUT_TYPE_LABELS[workout.workoutType]}</Badge>
            {workout.source === "whoop" && (
              <Badge className="bg-red-600 text-white hover:bg-red-700 text-xs">
                Whoop
              </Badge>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            {new Date(workout.date).toLocaleDateString()}
          </div>
        </div>
        <div className="flex gap-2">
          {isEditing ? (
            <>
              <Button variant="outline" onClick={handleCancelEdit}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveEdit}
                disabled={!formData || updateWorkout.isPending}
              >
                {updateWorkout.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleStartEdit}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              <Button variant="outline" onClick={handleSaveAsTemplate}>
                Save as Template
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteWorkout.isPending}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {isEditing && formData ? (
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
                  Total Volume: {formatVolume(calculateTotalVolume(formData.exercises))}
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
                    onUpdate={(updated) => handleUpdateExercise(index, updated)}
                    onRemove={() => handleRemoveExercise(index)}
                    onChangeExercise={() => handleChangeExercise(index)}
                  />
                ))}
              </div>
            )}

            <Button onClick={handleAddExercise} variant="outline" className="w-full">
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
      ) : (
        <>
          {/* Summary */}
          {workout.totalVolume && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-6">
                  <div>
                    <div className="text-sm text-muted-foreground">Total Volume</div>
                    <div className="text-2xl font-bold">
                      {formatVolume(workout.totalVolume)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Exercises</div>
                    <div className="text-2xl font-bold">{workout.logs.length}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Separator className="my-6" />

          {/* Exercises */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Exercises</h2>

            {workout.logs.map((log) => {
              const exerciseType = log.exercise?.exerciseType;
              const cardioStyle =
                exerciseType === "cardio" ||
                exerciseType === "hiit" ||
                exerciseType === "mobility";
              const exerciseVolume = log.sets.reduce(
                (sum, set) => sum + (set.reps ?? 0) * (set.weight ?? 0),
                0,
              );

              return (
                <Card key={log.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>{log.exerciseName}</CardTitle>
                      {exerciseVolume > 0 && (
                        <span className="text-sm text-muted-foreground">
                          Volume: {formatVolume(exerciseVolume)}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {cardioStyle ? (
                      <div className="grid gap-3 text-sm md:grid-cols-2">
                        {exerciseType === "cardio" && (
                          <>
                            <div>
                              <div className="text-muted-foreground">Distance</div>
                              <div>{log.distance ?? "-"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Duration</div>
                              <div>{formatLoggedDuration(log.durationSeconds)}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Pace</div>
                              <div>{formatLoggedPace(log.pace)}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Heart Rate</div>
                              <div>{log.heartRate ?? "-"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Intensity</div>
                              <div>{log.intensity ?? "-"}</div>
                            </div>
                          </>
                        )}
                        {exerciseType === "hiit" && (
                          <>
                            <div>
                              <div className="text-muted-foreground">Rounds</div>
                              <div>{log.rounds ?? "-"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Work Duration</div>
                              <div>{formatLoggedDuration(log.workDurationSeconds)}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Rest Duration</div>
                              <div>{formatLoggedDuration(log.restDurationSeconds)}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Intensity</div>
                              <div>{log.intensity ?? "-"}</div>
                            </div>
                          </>
                        )}
                        {exerciseType === "mobility" && (
                          <>
                            <div>
                              <div className="text-muted-foreground">Rounds</div>
                              <div>{log.rounds ?? "-"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Duration Per Round</div>
                              <div>{formatLoggedDuration(log.durationSeconds)}</div>
                            </div>
                          </>
                        )}
                      </div>
                    ) : log.sets.length > 0 ? (
                      <div className="space-y-1">
                        <div className="grid grid-cols-[50px_1fr_1fr_1fr] gap-2 text-sm font-medium text-muted-foreground">
                          <div>Set</div>
                          <div>Reps</div>
                          <div>Weight</div>
                          <div>RPE</div>
                        </div>
                        {log.sets.map((set) => (
                          <div
                            key={set.id}
                            className="grid grid-cols-[50px_1fr_1fr_1fr] gap-2 text-sm"
                          >
                            <div>{set.setNumber}</div>
                            <div>{set.reps ?? "-"}</div>
                            <div>{set.weight ? `${set.weight} lbs` : "-"}</div>
                            <div>{set.rpe ?? "-"}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        No sets recorded
                      </div>
                    )}
                    {log.notes && (
                      <div className="mt-3 text-sm">
                        <span className="font-medium">Notes:</span> {log.notes}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Workout Notes */}
          {workout.notes && (
            <>
              <Separator className="my-6" />
              <div>
                <h2 className="mb-2 text-lg font-semibold">Workout Notes</h2>
                <p className="text-sm text-muted-foreground">{workout.notes}</p>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
