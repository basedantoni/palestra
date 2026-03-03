import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Calendar, Plus } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SuggestionBadge } from "@/components/workout/suggestion-badge";
import { formatVolume, WORKOUT_TYPE_LABELS } from "@src/api/lib/index";

export const Route = createFileRoute("/workouts/")({
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
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data: workouts, isLoading } = useQuery(
    trpc.workouts.listWithSummary.queryOptions({
      limit,
      offset: page * limit,
    }),
  );

  const { data: progressiveOverload } = useQuery(
    trpc.analytics.progressiveOverload.queryOptions(),
  );

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Workout History</h1>
        <Link to="/workouts/new">
          <Button>
            <Plus className="h-4 w-4" />
            New Workout
          </Button>
        </Link>
      </div>

      {/* Progressive Overload Summary */}
      {progressiveOverload && progressiveOverload.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">Progressive Overload</h2>
          <div className="space-y-2">
            {progressiveOverload.map((item) => (
              <Card key={item.exerciseId}>
                <CardContent className="flex items-start justify-between py-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">
                      {item.exerciseName ?? item.exerciseId}
                    </span>
                    {item.suggestion && (
                      <span className="text-xs text-muted-foreground">
                        {item.suggestion.message}
                      </span>
                    )}
                  </div>
                  {item.trendStatus && (
                    <SuggestionBadge
                      trendStatus={item.trendStatus as "improving" | "plateau" | "declining"}
                      suggestion={item.suggestion}
                      compact
                    />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Workout List */}
      {isLoading ? (
        <div className="text-center text-muted-foreground">Loading...</div>
      ) : workouts && workouts.length > 0 ? (
        <div className="space-y-4">
          {workouts.map((workout) => (
            <Link
              key={workout.id}
              to="/workouts/$workoutId"
              params={{ workoutId: workout.id }}
            >
              <Card className="transition-colors hover:bg-muted/50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle>
                        {new Date(workout.date).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </CardTitle>
                      <Badge variant="secondary">
                        {WORKOUT_TYPE_LABELS[workout.workoutType]}
                      </Badge>
                    </div>
                    {workout.totalVolume && (
                      <div className="text-sm text-muted-foreground">
                        Volume: {formatVolume(workout.totalVolume)}
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="text-sm">
                      <span className="font-medium">
                        {workout.exerciseCount}
                      </span>{" "}
                      {workout.exerciseCount === 1 ? "exercise" : "exercises"}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {workout.exerciseNames.join(", ")}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}

          {/* Pagination */}
          <div className="flex justify-between pt-4">
            <Button
              variant="outline"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">Page {page + 1}</span>
            <Button
              variant="outline"
              onClick={() => setPage((p) => p + 1)}
              disabled={!workouts || workouts.length < limit}
            >
              Next
            </Button>
          </div>
        </div>
      ) : (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">No workouts yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Start logging your first workout!
          </p>
          <Link to="/workouts/new">
            <Button className="mt-4">
              <Plus className="h-4 w-4" />
              Start First Workout
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
