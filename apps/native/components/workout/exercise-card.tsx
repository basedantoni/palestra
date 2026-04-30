import { Ionicons } from "@expo/vector-icons";
import { Card } from "heroui-native";
import { Pressable, Text, TextInput, View } from "react-native";

import type { WorkoutExerciseFormData, WorkoutSetFormData } from "@src/api/lib/workout-utils";
import {
  calculateExerciseVolume,
  createBlankSet,
  formatVolume,
} from "@src/api/lib/workout-utils";

import { SuggestionBadge } from "./SuggestionBadge";
import { useExerciseSuggestion } from "./useExerciseSuggestion";

function ExerciseSuggestionBadge({ exerciseId }: { exerciseId: string }) {
  const { suggestion, trendStatus } = useExerciseSuggestion(exerciseId);
  if (!trendStatus) return null;
  return (
    <View className="mt-1.5">
      <SuggestionBadge trendStatus={trendStatus} suggestion={suggestion} compact />
    </View>
  );
}

function isTimedSet(set: WorkoutSetFormData): boolean {
  return set.durationSeconds !== undefined && set.reps === undefined;
}

interface ExerciseCardProps {
  exercise: WorkoutExerciseFormData;
  onUpdate: (updated: WorkoutExerciseFormData) => void;
  onRemove: () => void;
  onChangeExercise: () => void;
}

export function ExerciseCard({
  exercise,
  onUpdate,
  onRemove,
  onChangeExercise,
}: ExerciseCardProps) {
  const handleAddSet = () => {
    const lastSet = exercise.sets[exercise.sets.length - 1];
    const timed = lastSet ? isTimedSet(lastSet) : false;
    const newSet = createBlankSet(exercise.sets.length + 1);

    if (timed) {
      newSet.durationSeconds = lastSet?.durationSeconds;
    } else if (lastSet) {
      newSet.reps = lastSet.reps;
      newSet.weight = lastSet.weight;
      newSet.rpe = lastSet.rpe;
    }

    onUpdate({
      ...exercise,
      sets: [...exercise.sets, newSet],
    });
  };

  const handleRemoveSet = (setIndex: number) => {
    const updatedSets = exercise.sets
      .filter((_, i) => i !== setIndex)
      .map((set, i) => ({
        ...set,
        setNumber: i + 1,
      }));
    onUpdate({
      ...exercise,
      sets: updatedSets,
    });
  };

  const handleUpdateSet = (
    setIndex: number,
    field: "reps" | "weight" | "rpe" | "durationSeconds",
    value: string,
  ) => {
    const updatedSets = [...exercise.sets];
    let numValue: number | undefined;
    if (value === "") {
      numValue = undefined;
    } else {
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        numValue = undefined;
      } else if (field === "rpe") {
        numValue = Math.min(10, Math.max(1, Math.round(parsed)));
      } else if (field === "reps" || field === "durationSeconds") {
        numValue = Math.max(0, Math.round(parsed));
      } else {
        numValue = Math.max(0, parsed);
      }
    }
    updatedSets[setIndex] = {
      ...updatedSets[setIndex],
      [field]: numValue,
    };
    onUpdate({
      ...exercise,
      sets: updatedSets,
    });
  };

  const handleToggleSetMode = (setIndex: number) => {
    const updatedSets = [...exercise.sets];
    const set = updatedSets[setIndex]!;
    if (isTimedSet(set)) {
      updatedSets[setIndex] = { ...set, durationSeconds: undefined, reps: undefined };
    } else {
      updatedSets[setIndex] = { ...set, reps: undefined, weight: undefined, durationSeconds: 30 };
    }
    onUpdate({ ...exercise, sets: updatedSets });
  };

  const volume = calculateExerciseVolume(exercise);
  const anyTimed = exercise.sets.some(isTimedSet);
  const anyWeighted = exercise.sets.some((s) => !isTimedSet(s));
  const mixedModes = anyTimed && anyWeighted;

  const repsHeader = mixedModes ? "Reps/s" : anyTimed ? "Dur (s)" : "Reps";

  return (
    <Card variant="secondary" className="p-4">
      {/* Exercise Header */}
      <View className="flex-row items-center justify-between mb-3">
        <Pressable onPress={onChangeExercise} className="flex-1">
          <Text className="text-base font-semibold text-foreground">
            {exercise.exerciseName || "Select Exercise"}
          </Text>
          {volume > 0 ? (
            <Text className="text-sm text-muted mt-0.5">
              {anyTimed && !anyWeighted ? `${volume}s total` : `Volume: ${formatVolume(volume)}`}
            </Text>
          ) : null}
          {exercise.exerciseId ? (
            <ExerciseSuggestionBadge exerciseId={exercise.exerciseId} />
          ) : null}
        </Pressable>
        <Pressable onPress={onRemove} className="p-2">
          <Ionicons name="trash-outline" size={20} color="#999" />
        </Pressable>
      </View>

      {/* Sets Table */}
      {exercise.sets.length > 0 ? (
        <View>
          {/* Table Header */}
          <View className="flex-row items-center mb-2 pb-2 border-b border-border">
            <Text className="text-xs font-medium text-muted w-10 text-center">
              Set
            </Text>
            <Text className="text-xs font-medium text-muted flex-1 text-center">
              {repsHeader}
            </Text>
            <Text className="text-xs font-medium text-muted flex-1 text-center">
              Weight
            </Text>
            <Text className="text-xs font-medium text-muted flex-1 text-center">
              RPE
            </Text>
            <View className="w-8" />
            <View className="w-8" />
          </View>

          {/* Table Rows */}
          {exercise.sets.map((set, index) => {
            const timed = isTimedSet(set);
            return (
              <View key={set.tempId} className="flex-row items-center mb-2">
                <Text className="text-sm text-foreground w-10 text-center">
                  {set.setNumber}
                </Text>
                <View className="flex-1 px-1">
                  {timed ? (
                    <TextInput
                      className="border border-border rounded px-2 py-1.5 text-center text-foreground bg-background"
                      keyboardType="number-pad"
                      placeholder="30"
                      placeholderTextColor="#999"
                      value={set.durationSeconds?.toString() || ""}
                      onChangeText={(text) => handleUpdateSet(index, "durationSeconds", text)}
                    />
                  ) : (
                    <TextInput
                      className="border border-border rounded px-2 py-1.5 text-center text-foreground bg-background"
                      keyboardType="number-pad"
                      placeholder="-"
                      placeholderTextColor="#999"
                      value={set.reps?.toString() || ""}
                      onChangeText={(text) => handleUpdateSet(index, "reps", text)}
                    />
                  )}
                </View>
                <View className="flex-1 px-1">
                  <TextInput
                    className="border border-border rounded px-2 py-1.5 text-center text-foreground bg-background"
                    keyboardType="decimal-pad"
                    placeholder="-"
                    placeholderTextColor="#999"
                    editable={!timed}
                    value={timed ? "" : (set.weight?.toString() || "")}
                    onChangeText={(text) => handleUpdateSet(index, "weight", text)}
                    style={timed ? { opacity: 0.3 } : undefined}
                  />
                </View>
                <View className="flex-1 px-1">
                  <TextInput
                    className="border border-border rounded px-2 py-1.5 text-center text-foreground bg-background"
                    keyboardType="number-pad"
                    placeholder="-"
                    placeholderTextColor="#999"
                    value={set.rpe?.toString() || ""}
                    onChangeText={(text) => handleUpdateSet(index, "rpe", text)}
                  />
                </View>
                {/* Timed mode toggle */}
                <Pressable
                  onPress={() => handleToggleSetMode(index)}
                  className="w-8 items-center"
                >
                  <Ionicons
                    name="timer-outline"
                    size={18}
                    color={timed ? "#6366f1" : "#999"}
                  />
                </Pressable>
                <Pressable
                  onPress={() => handleRemoveSet(index)}
                  className="w-8 items-center"
                >
                  <Ionicons name="close-circle-outline" size={20} color="#999" />
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* Cardio fields — distance and duration for cardio/hiit exercises */}
      {exercise.exerciseType === "cardio" || exercise.exerciseType === "hiit" ? (
        <View className="mt-3 flex-row gap-3">
          <View className="flex-1">
            <Text className="text-xs text-muted mb-1">Distance (m)</Text>
            <TextInput
              className="border border-border rounded px-2 py-1.5 text-center text-foreground bg-background"
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor="#999"
              value={exercise.distanceMeter?.toString() ?? ""}
              onChangeText={(text) => {
                const val = text === "" ? undefined : Math.max(0, Number(text));
                onUpdate({ ...exercise, distanceMeter: Number.isNaN(val) ? undefined : val });
              }}
            />
          </View>
          <View className="flex-1">
            <Text className="text-xs text-muted mb-1">Duration (s)</Text>
            <TextInput
              className="border border-border rounded px-2 py-1.5 text-center text-foreground bg-background"
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#999"
              value={exercise.durationSeconds?.toString() ?? ""}
              onChangeText={(text) => {
                const val = text === "" ? undefined : Math.max(0, Math.round(Number(text)));
                onUpdate({ ...exercise, durationSeconds: Number.isNaN(val) ? undefined : val });
              }}
            />
          </View>
          <View className="flex-1">
            <Text className="text-xs text-muted mb-1">Avg HR</Text>
            <TextInput
              className="border border-border rounded px-2 py-1.5 text-center text-foreground bg-background"
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#999"
              value={exercise.heartRate?.toString() ?? ""}
              onChangeText={(text) => {
                const val = text === "" ? undefined : Math.max(0, Math.round(Number(text)));
                onUpdate({ ...exercise, heartRate: Number.isNaN(val) ? undefined : val });
              }}
            />
          </View>
        </View>
      ) : (
        /* Add Set Button — only for non-cardio exercises */
        <Pressable
          onPress={handleAddSet}
          className="mt-2 py-2 border border-dashed border-border rounded-lg items-center"
        >
          <Text className="text-sm text-primary font-medium">+ Add Set</Text>
        </Pressable>
      )}
    </Card>
  );
}
