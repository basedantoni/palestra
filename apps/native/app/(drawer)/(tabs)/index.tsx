import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button, Card } from "heroui-native";
import { FlatList, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import {
  formatVolume,
  WORKOUT_TYPE_LABELS,
} from "@src/api/lib/workout-utils";

export default function DashboardTab() {
  const { data: session } = authClient.useSession();
  const recentWorkouts = useQuery(
    trpc.workouts.listWithSummary.queryOptions({ limit: 5 }),
  );

  const formatDate = (date: Date | string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <Container className="flex-1">
      <View className="p-6">
        <Text className="text-2xl font-bold text-foreground mb-1">
          Dashboard
        </Text>
        <Text className="text-muted mb-6">
          {session?.user?.name ? `Welcome back, ${session.user.name}` : "Welcome back"}
        </Text>

        <Button onPress={() => router.push("/new-workout")} className="mb-6">
          <Button.Label>Start New Workout</Button.Label>
        </Button>

        <Text className="text-lg font-semibold text-foreground mb-3">
          Recent Workouts
        </Text>

        {recentWorkouts.isLoading ? (
          <Text className="text-muted text-center py-8">Loading...</Text>
        ) : recentWorkouts.data && recentWorkouts.data.length > 0 ? (
          <FlatList
            data={recentWorkouts.data}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => router.push(`/workout-detail/${item.id}`)}
              >
                <Card variant="secondary" className="mb-3 p-4">
                  <View className="flex-row justify-between items-start mb-2">
                    <Text className="text-base font-semibold text-foreground">
                      {formatDate(item.date)}
                    </Text>
                    <View className="bg-primary/10 px-2 py-1 rounded">
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
                </Card>
              </Pressable>
            )}
            scrollEnabled={false}
          />
        ) : (
          <View className="py-8 items-center">
            <Text className="text-muted text-center mb-2">No workouts yet</Text>
            <Text className="text-muted text-center text-sm">
              Tap "Start New Workout" to log your first workout
            </Text>
          </View>
        )}
      </View>
    </Container>
  );
}
