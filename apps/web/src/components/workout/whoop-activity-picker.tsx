import { format } from "date-fns";
import { AlertCircle, Check, RefreshCw, Wifi } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDistance } from "@src/api/lib/index";

export interface WhoopActivity {
  id: string;
  start: string;
  end: string;
  sportName: string;
  durationMinutes: number;
  strain: number | null;
  averageHeartRate: number | null;
  distanceMeter: number | null;
  alreadyLinked: boolean;
  linkedWorkoutId: string | null;
  linkedWorkoutDate: string | null;
}

export interface WhoopActivityPickerProps {
  workoutDate: string; // ISO date string, e.g. "2026-04-29"
  selectedActivityId: string | null;
  onSelect: (activityId: string | null) => void;
  distanceUnit?: "mi" | "km";
}

export function WhoopActivityPicker({
  workoutDate,
  selectedActivityId,
  onSelect,
  distanceUnit = "mi",
}: WhoopActivityPickerProps) {
  const connectionQuery = useQuery(trpc.whoop.connectionStatus.queryOptions());

  const activitiesQuery = useQuery(
    trpc.whoop.listUnlinkedCardioActivities.queryOptions(
      { date: workoutDate },
      {
        enabled: connectionQuery.data?.connected === true,
        retry: 1,
      },
    ),
  );

  // Not connected state
  if (connectionQuery.data?.connected === false) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
        <Wifi className="h-6 w-6 opacity-40" />
        <p>Whoop not connected</p>
        <p className="text-xs">Connect Whoop in settings to link activities</p>
      </div>
    );
  }

  // Loading state
  if (connectionQuery.isLoading || activitiesQuery.isLoading) {
    return (
      <div className="space-y-2 py-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  // Error state
  if (activitiesQuery.isError) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center text-sm">
        <AlertCircle className="h-6 w-6 text-destructive opacity-70" />
        <p className="text-muted-foreground">Failed to load Whoop activities</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => activitiesQuery.refetch()}
          className="gap-1"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  const activities = activitiesQuery.data?.activities ?? [];

  // Empty state
  if (activities.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        <p>No Whoop activities found within 3 days of this date</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {activities.map((activity) => {
        const isSelected = selectedActivityId === activity.id;
        const startDate = new Date(activity.start);

        return (
          <button
            key={activity.id}
            type="button"
            onClick={() => onSelect(isSelected ? null : activity.id)}
            className={cn(
              "w-full rounded-md border p-3 text-left transition-colors",
              isSelected
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border hover:bg-muted",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">
                    {activity.sportName}
                  </span>
                  {activity.alreadyLinked && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      Linked to workout
                      {activity.linkedWorkoutDate
                        ? ` · ${format(new Date(activity.linkedWorkoutDate), "MMM d")}`
                        : ""}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{format(startDate, "MMM d, h:mm a")}</span>
                  <span>{activity.durationMinutes} min</span>
                  {activity.averageHeartRate != null && (
                    <span>{activity.averageHeartRate} bpm avg</span>
                  )}
                  {activity.distanceMeter != null && (
                    <span>
                      {formatDistance(activity.distanceMeter, distanceUnit)}
                    </span>
                  )}
                  {activity.strain != null && (
                    <span>Strain {activity.strain.toFixed(1)}</span>
                  )}
                </div>
              </div>
              {isSelected && (
                <Check className="h-4 w-4 shrink-0 text-primary mt-0.5" />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
