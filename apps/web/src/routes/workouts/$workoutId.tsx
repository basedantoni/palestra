import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Calendar, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WORKOUT_TYPE_LABELS } from "@src/api/lib/index";

import { WorkoutViewMode } from "./-components/WorkoutViewMode";
import {
  WorkoutEditMode,
  type WorkoutEditModeHandle,
} from "./-components/WorkoutEditMode";

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
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const editRef = useRef<WorkoutEditModeHandle>(null);

  const { data: workout, isLoading } = useQuery(
    trpc.workouts.get.queryOptions({ id: workoutId }),
  );
  const { data: preferences } = useQuery(trpc.preferences.get.queryOptions());
  const distanceUnit = preferences?.distanceUnit ?? "mi";

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
        <div className="text-center text-muted-foreground">
          Workout not found
        </div>
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
            {workout.whoopActivityId && !isEditing && (
              <Badge className="bg-red-600/10 text-red-700 border-red-600/20 hover:bg-red-600/20 text-xs">
                Linked to Whoop
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
              <Button
                variant="outline"
                onClick={() => editRef.current?.cancel()}
              >
                Cancel
              </Button>
              <Button
                onClick={() => editRef.current?.save()}
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setIsEditing(true)}>
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

      {isEditing ? (
        <WorkoutEditMode
          ref={editRef}
          workout={workout}
          workoutId={workoutId}
          distanceUnit={distanceUnit}
          onSaved={() => setIsEditing(false)}
          onCancel={() => setIsEditing(false)}
          onPendingChange={setIsSaving}
        />
      ) : (
        <WorkoutViewMode
          workout={workout as any}
          distanceUnit={distanceUnit}
        />
      )}
    </div>
  );
}
