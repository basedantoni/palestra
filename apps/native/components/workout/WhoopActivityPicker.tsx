import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { trpc } from "@/utils/trpc";
import { formatDistance } from "@src/api/lib/workout-utils";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export interface WhoopActivityPickerProps {
  workoutDate: string; // ISO date string e.g. "2026-04-29"
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
  const connectionQuery = useQuery(
    trpc.whoop.connectionStatus.queryOptions(),
  );

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
      <View className="py-6 items-center gap-2">
        <Text className="text-sm text-muted text-center">
          Whoop not connected
        </Text>
        <Text className="text-xs text-muted text-center">
          Connect Whoop in settings to link activities
        </Text>
      </View>
    );
  }

  // Loading state
  if (connectionQuery.isLoading || activitiesQuery.isLoading) {
    return (
      <View className="py-6 items-center">
        <ActivityIndicator />
        <Text className="text-sm text-muted mt-2">Loading Whoop activities...</Text>
      </View>
    );
  }

  // Error state
  if (activitiesQuery.isError) {
    return (
      <View className="py-6 items-center gap-2">
        <Text className="text-sm text-destructive text-center">
          Failed to load Whoop activities
        </Text>
        <Pressable
          onPress={() => activitiesQuery.refetch()}
          className="px-4 py-2 rounded-md border border-border"
        >
          <Text className="text-sm text-foreground">Retry</Text>
        </Pressable>
      </View>
    );
  }

  const activities = activitiesQuery.data?.activities ?? [];

  // Empty state
  if (activities.length === 0) {
    return (
      <View className="py-6 items-center">
        <Text className="text-sm text-muted text-center">
          No Whoop activities found within 3 days of this date
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-2">
      {activities.map((activity) => {
        const isSelected = selectedActivityId === activity.id;
        const isDisabled = activity.alreadyLinked && !isSelected;

        const metaParts: string[] = [
          `${activity.durationMinutes} min`,
        ];
        if (activity.averageHeartRate != null) {
          metaParts.push(`${activity.averageHeartRate} bpm avg`);
        }
        if (activity.distanceMeter != null) {
          metaParts.push(formatDistance(activity.distanceMeter, distanceUnit));
        }
        if (activity.strain != null) {
          metaParts.push(`Strain ${activity.strain.toFixed(1)}`);
        }

        return (
          <Pressable
            key={activity.id}
            onPress={() => {
              if (isDisabled) return;
              onSelect(isSelected ? null : activity.id);
            }}
            className={[
              "rounded-lg border p-3",
              isSelected
                ? "border-primary bg-primary/10"
                : "border-border bg-card",
              isDisabled ? "opacity-40" : "",
            ].join(" ")}
          >
            <View className="flex-row items-start justify-between gap-2">
              <View className="flex-1 min-w-0">
                <View className="flex-row items-center gap-2 flex-wrap">
                  <Text className="text-sm font-medium text-foreground">
                    {activity.sportName}
                  </Text>
                  {activity.alreadyLinked && (
                    <View className="bg-muted rounded px-1.5 py-0.5">
                      <Text className="text-[10px] text-muted-foreground">
                        Linked
                      </Text>
                    </View>
                  )}
                </View>
                <Text className="text-xs text-muted mt-0.5">
                  {formatDate(activity.start)}
                </Text>
                <Text className="text-xs text-muted mt-0.5">
                  {metaParts.join(" · ")}
                </Text>
              </View>
              {isSelected && (
                <View className="w-5 h-5 rounded-full bg-primary items-center justify-center mt-0.5">
                  <Text className="text-[10px] text-primary-foreground font-bold">
                    ✓
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
