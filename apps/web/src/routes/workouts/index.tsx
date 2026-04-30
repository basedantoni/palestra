import { useMemo, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type { DayButton } from "react-day-picker";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { SuggestionBadge } from "@/components/workout/suggestion-badge";
import { cn } from "@/lib/utils";
import {
  buildCalendarDayMetadata,
  formatVolume,
  getLocalDateKey,
  getLocalMonthRange,
  groupWorkoutsByLocalDay,
  WORKOUT_TYPE_LABELS,
} from "@src/api/lib/index";

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

function dateFromLocalKey(localKey: string): Date {
  const [year, month, day] = localKey.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

type WorkoutHistoryFilter = "all" | "running" | "mobility" | "lifting" | "other";

function matchesWorkoutTypeFilter(
  workout: { workoutType: string },
  filter: WorkoutHistoryFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "running") {
    return workout.workoutType === "cardio" || workout.workoutType === "hiit";
  }
  if (filter === "mobility") {
    return workout.workoutType === "mobility" || workout.workoutType === "yoga";
  }
  if (filter === "lifting") {
    return (
      workout.workoutType === "weightlifting" ||
      workout.workoutType === "calisthenics"
    );
  }
  return !matchesWorkoutTypeFilter(workout, "running") &&
    !matchesWorkoutTypeFilter(workout, "mobility") &&
    !matchesWorkoutTypeFilter(workout, "lifting");
}

function RouteComponent() {
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<WorkoutHistoryFilter>("all");

  const monthRange = useMemo(() => getLocalMonthRange(visibleMonth), [visibleMonth]);

  const { data: workouts, isLoading } = useQuery(
    trpc.workouts.calendarRange.queryOptions({
      startDate: monthRange.startDate,
      endDate: monthRange.endDate,
    }),
  );

  const { data: progressiveOverload } = useQuery(
    trpc.analytics.progressiveOverload.queryOptions(),
  );

  const groupedByDay = useMemo(
    () => groupWorkoutsByLocalDay(workouts ?? []),
    [workouts],
  );
  const filteredGroupedByDay: typeof groupedByDay = useMemo(() => {
    if (typeFilter === "all") return groupedByDay;

    return Object.fromEntries(
      Object.entries(groupedByDay)
        .map(([day, dayWorkouts]) => [
          day,
          dayWorkouts.filter((workout: (typeof dayWorkouts)[number]) =>
            matchesWorkoutTypeFilter(workout, typeFilter),
          ),
        ])
        .filter(([, dayWorkouts]) => dayWorkouts.length > 0),
    );
  }, [groupedByDay, typeFilter]);
  const dayMetadata = useMemo(
    () => buildCalendarDayMetadata(filteredGroupedByDay),
    [filteredGroupedByDay],
  );

  const daysWithWorkouts = useMemo(() => {
    return Object.keys(dayMetadata).map((key) => dateFromLocalKey(key));
  }, [dayMetadata]);

  useEffect(() => {
    if (!workouts) return;

    const today = new Date();
    const todayKey = getLocalDateKey(today);
    const selectedKey = selectedDate ? getLocalDateKey(selectedDate) : null;

    if (selectedKey && filteredGroupedByDay[selectedKey]) {
      return;
    }

    let nextSelectedKey = todayKey;
    let nextSelectedDate = today;

    if (filteredGroupedByDay[todayKey]) {
      nextSelectedKey = todayKey;
      nextSelectedDate = today;
    } else {
      const firstVisibleDay = Object.keys(filteredGroupedByDay)[0];
      if (firstVisibleDay) {
        nextSelectedKey = firstVisibleDay;
        nextSelectedDate = dateFromLocalKey(firstVisibleDay);
      }
    }

    if (selectedKey !== nextSelectedKey) {
      setSelectedDate(nextSelectedDate);
    }
  }, [workouts, filteredGroupedByDay, selectedDate]);

  const selectedKey = selectedDate ? getLocalDateKey(selectedDate) : undefined;
  const workoutsForSelectedDay = selectedKey
    ? filteredGroupedByDay[selectedKey] ?? []
    : [];

  return (
    <div className="container mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Workout History</h1>
        <Link to="/workouts/new">
          <Button>
            <Plus className="h-4 w-4" />
            New Workout
          </Button>
        </Link>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Calendar</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-2">
            {(
              [
                ["all", "All"],
                ["running", "Running"],
                ["mobility", "Mobility"],
                ["lifting", "Lifting"],
                ["other", "Other"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={typeFilter === value ? "default" : "outline"}
                onClick={() => setTypeFilter(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading calendar...</div>
          ) : (
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => setSelectedDate(date ?? undefined)}
              month={visibleMonth}
              onMonthChange={setVisibleMonth}
              modifiers={{ hasWorkouts: daysWithWorkouts }}
              modifiersClassNames={{
                hasWorkouts: "font-semibold text-foreground",
              }}
              components={{
                DayButton: (props: React.ComponentProps<typeof DayButton>) => {
                  const dayKey = getLocalDateKey(props.day.date);
                  const count = dayMetadata[dayKey]?.count ?? 0;
                  return (
                    <CalendarDayButton
                      {...props}
                      className={cn(props.className, count > 0 && "pb-4")}
                    >
                      {props.children}
                      {count === 1 ? (
                        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-primary" />
                      ) : count > 1 ? (
                        <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 rounded bg-primary px-1 py-0 text-[10px] leading-4 text-primary-foreground">
                          {count > 9 ? "9+" : count}
                        </span>
                      ) : null}
                    </CalendarDayButton>
                  );
                },
              }}
            />
          )}
        </CardContent>
      </Card>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>
            {selectedDate
              ? selectedDate.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })
              : "Selected Day"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {workoutsForSelectedDay.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No workouts logged for this day.
            </div>
          ) : (
            <div className="space-y-3">
              {workoutsForSelectedDay.map((workout) => (
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
                            {new Date(workout.date).toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </CardTitle>
                          <Badge variant="secondary">
                            {WORKOUT_TYPE_LABELS[workout.workoutType]}
                          </Badge>
                          {workout.source === "whoop" && (
                            <Badge className="bg-red-600 text-white hover:bg-red-700 text-xs">
                              Whoop
                            </Badge>
                          )}
                        </div>
                        {workout.totalVolume ? (
                          <div className="text-sm text-muted-foreground">
                            Volume: {formatVolume(workout.totalVolume)}
                          </div>
                        ) : null}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-sm text-muted-foreground">
                        {workout.exerciseCount}{" "}
                        {workout.exerciseCount === 1 ? "exercise" : "exercises"}
                      </div>
                      {workout.exerciseNames.length > 0 ? (
                        <div className="text-sm text-muted-foreground mt-1">
                          {workout.exerciseNames.join(", ")}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
    </div>
  );
}
