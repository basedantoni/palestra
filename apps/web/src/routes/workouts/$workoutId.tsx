import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Calendar, Trash2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  formatVolume,
  WORKOUT_TYPE_LABELS,
  calculateExerciseVolume,
} from "@src/api/lib/index";

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

  const { data: workout, isLoading } = useQuery(
    trpc.workouts.get.queryOptions({ id: workoutId }),
  );

  const deleteWorkout = useMutation(
    trpc.workouts.delete.mutationOptions({
      onSuccess: () => {
        navigate({ to: "/workouts" });
      },
    }),
  );

  const saveAsTemplate = useMutation(
    trpc.workouts.saveAsTemplate.mutationOptions({
      onSuccess: () => {
        alert("Workout saved as template!");
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
    if (name) {
      saveAsTemplate.mutate({ workoutId, name });
    }
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Workout Details</h1>
            <Badge>{WORKOUT_TYPE_LABELS[workout.workoutType]}</Badge>
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            {new Date(workout.date).toLocaleDateString()}
          </div>
        </div>
        <div className="flex gap-2">
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
        </div>
      </div>

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
                {log.sets.length > 0 ? (
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
    </div>
  );
}
