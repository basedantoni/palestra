import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Card } from "heroui-native";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

import { Container } from "@/components/container";
import { trpc } from "@/utils/trpc";
import {
  calculateSetVolume,
  formatVolume,
  WORKOUT_TYPE_LABELS,
} from "@src/api/lib/workout-utils";

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: workout, isLoading } = useQuery(
    trpc.workouts.get.queryOptions({ id }),
  );

  const deleteWorkout = useMutation(
    trpc.workouts.delete.mutationOptions({
      onSuccess: () => {
        router.back();
      },
      onError: (error) => {
        Alert.alert("Error", error.message || "Failed to delete workout");
      },
    }),
  );

  const saveAsTemplate = useMutation(
    trpc.workouts.saveAsTemplate.mutationOptions({
      onSuccess: () => {
        Alert.alert("Success", "Workout saved as template");
      },
      onError: (error) => {
        Alert.alert(
          "Error",
          error.message || "Failed to save as template",
        );
      },
    }),
  );

  const handleDelete = () => {
    Alert.alert(
      "Delete Workout",
      "Are you sure you want to delete this workout? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteWorkout.mutate({ id }),
        },
      ],
    );
  };

  const handleSaveAsTemplate = () => {
    Alert.prompt(
      "Save as Template",
      "Enter a name for this template:",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: (name?: string) => {
            if (name && name.trim()) {
              saveAsTemplate.mutate({ workoutId: id, name: name.trim() });
            }
          },
        },
      ],
      "plain-text",
    );
  };

  const formatDate = (date: Date | string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  if (isLoading) {
    return (
      <Container className="flex-1 justify-center items-center">
        <Text className="text-muted">Loading workout...</Text>
      </Container>
    );
  }

  if (!workout) {
    return (
      <Container className="flex-1 justify-center items-center">
        <Text className="text-muted text-center mb-2">Workout not found</Text>
        <Button onPress={() => router.back()} variant="secondary">
          <Button.Label>Go Back</Button.Label>
        </Button>
      </Container>
    );
  }

  return (
    <Container className="flex-1">
      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Header */}
        <View className="p-6">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-2xl font-bold text-foreground">
              {formatDate(workout.date)}
            </Text>
            <Pressable onPress={handleDelete}>
              <Ionicons name="trash-outline" size={24} color="#999" />
            </Pressable>
          </View>

          <View className="flex-row items-center gap-2 mb-4">
            <View className="bg-primary/10 px-3 py-1 rounded-full">
              <Text className="text-sm text-primary font-medium">
                {WORKOUT_TYPE_LABELS[workout.workoutType] || workout.workoutType}
              </Text>
            </View>
            {workout.totalVolume ? (
              <View className="bg-secondary px-3 py-1 rounded-full">
                <Text className="text-sm text-secondary-foreground font-medium">
                  {formatVolume(workout.totalVolume)}
                </Text>
              </View>
            ) : null}
          </View>

          {workout.notes ? (
            <View className="bg-secondary p-3 rounded-lg mb-4">
              <Text className="text-sm text-secondary-foreground">
                {workout.notes}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Exercises */}
        <View className="px-6 pb-6">
          <Text className="text-lg font-semibold text-foreground mb-4">
            Exercises
          </Text>

          {workout.logs && workout.logs.length > 0 ? (
            <View className="gap-4">
              {workout.logs.map((log) => {
                const exerciseVolume = log.sets.reduce(
                  (sum, set) =>
                    sum + calculateSetVolume({
                      tempId: "",
                      setNumber: set.setNumber,
                      reps: set.reps ?? undefined,
                      weight: set.weight ?? undefined,
                      rpe: set.rpe ?? undefined,
                    }),
                  0,
                );

                return (
                  <Card key={log.id} variant="secondary" className="p-4">
                    <Text className="text-base font-semibold text-foreground mb-1">
                      {log.exerciseName}
                    </Text>
                    {exerciseVolume > 0 ? (
                      <Text className="text-sm text-muted mb-3">
                        Volume: {formatVolume(exerciseVolume)}
                      </Text>
                    ) : null}

                    {log.sets && log.sets.length > 0 ? (
                      <View>
                        {/* Table Header */}
                        <View className="flex-row items-center mb-2 pb-2 border-b border-border">
                          <Text className="text-xs font-medium text-muted w-12 text-center">
                            Set
                          </Text>
                          <Text className="text-xs font-medium text-muted flex-1 text-center">
                            Reps
                          </Text>
                          <Text className="text-xs font-medium text-muted flex-1 text-center">
                            Weight
                          </Text>
                          <Text className="text-xs font-medium text-muted flex-1 text-center">
                            RPE
                          </Text>
                        </View>

                        {/* Table Rows */}
                        {log.sets.map((set) => (
                          <View key={set.id} className="flex-row items-center py-1.5">
                            <Text className="text-sm text-foreground w-12 text-center">
                              {set.setNumber}
                            </Text>
                            <Text className="text-sm text-foreground flex-1 text-center">
                              {set.reps ?? "-"}
                            </Text>
                            <Text className="text-sm text-foreground flex-1 text-center">
                              {set.weight ?? "-"}
                            </Text>
                            <Text className="text-sm text-foreground flex-1 text-center">
                              {set.rpe ?? "-"}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}

                    {log.notes ? (
                      <Text className="text-sm text-muted mt-3 italic">
                        {log.notes}
                      </Text>
                    ) : null}
                  </Card>
                );
              })}
            </View>
          ) : (
            <Text className="text-muted text-center py-8">
              No exercises logged
            </Text>
          )}
        </View>

        {/* Actions */}
        <View className="px-6 pb-8 gap-3">
          <Button
            onPress={handleSaveAsTemplate}
            variant="secondary"
            isDisabled={saveAsTemplate.isPending}
          >
            <Button.Label>
              {saveAsTemplate.isPending ? "Saving..." : "Save as Template"}
            </Button.Label>
          </Button>
        </View>
      </ScrollView>
    </Container>
  );
}
