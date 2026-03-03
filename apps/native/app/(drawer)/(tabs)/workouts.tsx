import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Card } from "heroui-native";
import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SuggestionBadge } from "@/components/workout/SuggestionBadge";
import { trpc } from "@/utils/trpc";
import {
  formatVolume,
  WORKOUT_TYPE_LABELS,
} from "@src/api/lib/workout-utils";

export default function WorkoutsTab() {
  const [page, setPage] = useState(0);
  const limit = 20;

  const workouts = useQuery(
    trpc.workouts.listWithSummary.queryOptions({
      limit,
      offset: page * limit,
    }),
  );

  const overload = useQuery(
    trpc.analytics.progressiveOverload.queryOptions(),
  );

  const formatDate = (date: Date | string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const handleLoadMore = () => {
    if (workouts.data && workouts.data.length === limit) {
      setPage((prev) => prev + 1);
    }
  };

  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-background" style={{ paddingBottom: insets.bottom }}>
      {workouts.isLoading ? (
        <>
          <View className="p-6 pb-0">
            <Text className="text-2xl font-bold text-foreground mb-4">
              Workout History
            </Text>
          </View>
          <View className="flex-1 justify-center items-center">
            <Text className="text-muted">Loading workouts...</Text>
          </View>
        </>
      ) : workouts.data && workouts.data.length > 0 ? (
        <FlatList
          data={workouts.data}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/workout-detail/${item.id}`)}
            >
              <Card variant="secondary" className="mx-6 mb-3 p-4">
                <View className="flex-row justify-between items-start mb-2">
                  <Text className="text-base font-semibold text-foreground flex-1">
                    {formatDate(item.date)}
                  </Text>
                  <View className="bg-primary/10 px-2 py-1 rounded ml-2">
                    <Text className="text-xs text-primary">
                      {WORKOUT_TYPE_LABELS[item.workoutType] || item.workoutType}
                    </Text>
                  </View>
                </View>

                <Text className="text-sm text-muted mb-1">
                  {item.exerciseCount} {item.exerciseCount === 1 ? "exercise" : "exercises"}
                </Text>

                {item.exerciseNames && item.exerciseNames.length > 0 ? (
                  <Text className="text-sm text-muted mb-2" numberOfLines={2}>
                    {item.exerciseNames.join(", ")}
                  </Text>
                ) : null}

                {item.totalVolume ? (
                  <Text className="text-sm font-medium text-foreground">
                    Volume: {formatVolume(item.totalVolume)}
                  </Text>
                ) : null}

                {item.notes ? (
                  <Text className="text-xs text-muted mt-2" numberOfLines={1}>
                    {item.notes}
                  </Text>
                ) : null}
              </Card>
            </Pressable>
          )}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ paddingBottom: 100 }}
          ListHeaderComponent={
            <View>
              <View className="p-6 pb-0">
                <Text className="text-2xl font-bold text-foreground mb-4">
                  Workout History
                </Text>
              </View>
              {overload.data && overload.data.length > 0 ? (
              <View className="px-6 mb-4">
                <Text className="text-lg font-semibold text-foreground mb-3">
                  Progress Tracking
                </Text>
                {overload.data.map((item) => (
                  <Card key={item.exerciseId} variant="secondary" className="mb-2 p-3">
                    <View className="flex-row items-center justify-between">
                      <Text
                        className="text-sm font-medium text-foreground flex-1 mr-2"
                        numberOfLines={1}
                      >
                        {item.exerciseName ?? item.exerciseId}
                      </Text>
                      {item.trendStatus ? (
                        <SuggestionBadge
                          trendStatus={
                            item.trendStatus as
                              | "improving"
                              | "plateau"
                              | "declining"
                          }
                          suggestion={item.suggestion as any}
                          compact
                        />
                      ) : null}
                    </View>
                    {item.suggestion?.message ? (
                      <Text
                        className="text-xs text-muted mt-1"
                        numberOfLines={2}
                      >
                        {item.suggestion.message}
                      </Text>
                    ) : null}
                  </Card>
                ))}
              </View>
              ) : null}
            </View>
          }
          ListFooterComponent={
            workouts.data && workouts.data.length === limit ? (
              <View className="py-4 items-center">
                <Text className="text-muted text-sm">
                  Scroll for more workouts
                </Text>
              </View>
            ) : null
          }
        />
      ) : (
        <>
          <View className="p-6 pb-0">
            <Text className="text-2xl font-bold text-foreground mb-4">
              Workout History
            </Text>
          </View>
          <View className="flex-1 justify-center items-center px-6">
            <Text className="text-muted text-center mb-2">
              No workouts logged yet
            </Text>
            <Text className="text-muted text-center text-sm">
              Start your fitness journey by logging your first workout
            </Text>
          </View>
        </>
      )}
    </View>
  );
}
