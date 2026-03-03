import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatVolume, WORKOUT_TYPE_LABELS } from "@src/api/lib/index";

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent,
  beforeLoad: async ({ context }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({
        to: "/login",
        throw: true,
      });
    }

    // Check if onboarding is complete
    const isComplete = await context.queryClient.fetchQuery(
      context.trpc.preferences.isOnboardingComplete.queryOptions()
    );

    if (!isComplete) {
      redirect({ to: "/onboarding", throw: true });
    }

    return { session };
  },
});

function RouteComponent() {
  const { session } = Route.useRouteContext();

  const { data: recentWorkouts } = useQuery(
    trpc.workouts.listWithSummary.queryOptions({ limit: 5 }),
  );

  const { data: templates } = useQuery(trpc.templates.list.queryOptions());

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="text-muted-foreground">
        Welcome back, {session.data?.user.name}
      </p>

      {/* New Workout CTA */}
      <Link to="/workouts/new">
        <Button size="lg" className="mt-6 w-full">
          Start New Workout
        </Button>
      </Link>

      <Separator className="my-8" />

      {/* Recent Workouts */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent Workouts</h2>
          <Link to="/workouts" className="text-sm text-primary hover:underline">
            View All
          </Link>
        </div>

        {recentWorkouts && recentWorkouts.length > 0 ? (
          <div className="space-y-3">
            {recentWorkouts.map((workout) => (
              <Link
                key={workout.id}
                to="/workouts/$workoutId"
                params={{ workoutId: workout.id }}
              >
                <Card className="transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">
                          {new Date(workout.date).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </CardTitle>
                        <Badge variant="secondary" className="text-xs">
                          {WORKOUT_TYPE_LABELS[workout.workoutType]}
                        </Badge>
                      </div>
                      {workout.totalVolume && (
                        <div className="text-xs text-muted-foreground">
                          {formatVolume(workout.totalVolume)}
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground">
                      {workout.exerciseNames.slice(0, 3).join(", ")}
                      {workout.exerciseNames.length > 3 &&
                        `, +${workout.exerciseNames.length - 3} more`}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No workouts yet. Start your first workout to see it here!
            </CardContent>
          </Card>
        )}
      </section>

      {/* Templates Quick Start */}
      {templates && templates.length > 0 && (
        <>
          <Separator className="my-8" />
          <section>
            <h2 className="mb-4 text-lg font-semibold">Quick Start</h2>
            <div className="grid gap-3">
              {templates.slice(0, 4).map((template) => (
                <Link
                  key={template.id}
                  to="/workouts/new"
                  search={{ templateId: template.id }}
                >
                  <Card className="transition-colors hover:bg-muted/50">
                    <CardContent className="flex items-center justify-between py-4">
                      <div>
                        <div className="font-medium">{template.name}</div>
                        <Badge variant="secondary" className="mt-1 text-xs">
                          {WORKOUT_TYPE_LABELS[template.workoutType]}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
