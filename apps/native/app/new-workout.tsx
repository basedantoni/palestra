import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button } from "heroui-native";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { trpc } from "@/utils/trpc";
import type { WorkoutFormData } from "@src/api/lib/workout-utils";
import {
  calculateTotalVolume,
  createBlankExercise,
  formatVolume,
  formDataToApiInput,
  WORKOUT_TYPE_LABELS,
} from "@src/api/lib/workout-utils";

import { ExerciseCard } from "@/components/workout/exercise-card";
import { ExercisePicker } from "@/components/workout/exercise-picker";

const WORKOUT_TYPES = [
  "weightlifting",
  "hiit",
  "cardio",
  "calisthenics",
  "yoga",
  "sports",
  "mixed",
] as const;

export default function NewWorkoutScreen() {
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [editingExerciseIndex, setEditingExerciseIndex] = useState<
    number | null
  >(null);

  const [formData, setFormData] = useState<WorkoutFormData>({
    workoutType: "weightlifting",
    exercises: [],
    notes: "",
    templateId: undefined,
  });

  const createWorkout = useMutation(
    trpc.workouts.create.mutationOptions({
      onSuccess: (data) => {
        router.replace(`/workout-detail/${data.id}`);
      },
      onError: (error) => {
        Alert.alert("Error", error.message || "Failed to save workout");
      },
    }),
  );

  const handleAddExercise = () => {
    setEditingExerciseIndex(formData.exercises.length);
    setShowExercisePicker(true);
  };

  const handleChangeExercise = (index: number) => {
    setEditingExerciseIndex(index);
    setShowExercisePicker(true);
  };

  const handleSelectExercise = (exercise: { id: string; name: string }) => {
    if (editingExerciseIndex !== null) {
      const updatedExercises = [...formData.exercises];
      if (editingExerciseIndex >= updatedExercises.length) {
        // Adding new exercise
        updatedExercises.push({
          ...createBlankExercise(updatedExercises.length),
          exerciseId: exercise.id,
          exerciseName: exercise.name,
        });
      } else {
        // Changing existing exercise
        updatedExercises[editingExerciseIndex] = {
          ...updatedExercises[editingExerciseIndex],
          exerciseId: exercise.id,
          exerciseName: exercise.name,
        };
      }
      setFormData((prev) => ({ ...prev, exercises: updatedExercises }));
    }
    setShowExercisePicker(false);
  };

  const handleUpdateExercise = (
    index: number,
    updated: WorkoutFormData["exercises"][0],
  ) => {
    const updatedExercises = [...formData.exercises];
    updatedExercises[index] = updated;
    setFormData((prev) => ({ ...prev, exercises: updatedExercises }));
  };

  const handleRemoveExercise = (index: number) => {
    const updatedExercises = formData.exercises
      .filter((_, i) => i !== index)
      .map((ex, i) => ({ ...ex, order: i }));
    setFormData((prev) => ({ ...prev, exercises: updatedExercises }));
  };

  const handleSave = () => {
    const apiInput = formDataToApiInput(formData);
    createWorkout.mutate(apiInput);
  };

  const totalVolume = calculateTotalVolume(formData.exercises);
  const canSave =
    formData.exercises.length > 0 &&
    formData.exercises.every((ex) => ex.exerciseName.trim() !== "");

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-background"
    >
      {/* Header */}
      <View className="flex-row items-center justify-between p-4 border-b border-border">
        <Pressable onPress={() => router.back()}>
          <Text className="text-primary font-medium">Cancel</Text>
        </Pressable>
        <Text className="text-lg font-semibold text-foreground">
          New Workout
        </Text>
        <Pressable
          onPress={handleSave}
          disabled={!canSave || createWorkout.isPending}
        >
          <Text
            className={
              canSave && !createWorkout.isPending
                ? "text-primary font-medium"
                : "text-muted font-medium"
            }
          >
            {createWorkout.isPending ? "Saving..." : "Save"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Workout Type Selector */}
        <View className="p-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            Workout Type
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="flex-row gap-2"
          >
            {WORKOUT_TYPES.map((type) => (
              <Pressable
                key={type}
                onPress={() =>
                  setFormData((prev) => ({ ...prev, workoutType: type }))
                }
                className={
                  formData.workoutType === type
                    ? "px-4 py-2 rounded-full bg-primary"
                    : "px-4 py-2 rounded-full bg-secondary"
                }
              >
                <Text
                  className={
                    formData.workoutType === type
                      ? "text-primary-foreground text-sm font-medium"
                      : "text-secondary-foreground text-sm"
                  }
                >
                  {WORKOUT_TYPE_LABELS[type] || type}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Exercises */}
        <View className="px-4">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-base font-semibold text-foreground">
              Exercises
            </Text>
            {totalVolume > 0 ? (
              <Text className="text-sm text-muted">
                Total Volume: {formatVolume(totalVolume)}
              </Text>
            ) : null}
          </View>

          {formData.exercises.length === 0 ? (
            <View className="py-12 items-center">
              <Text className="text-muted text-center mb-1">
                No exercises added yet
              </Text>
              <Text className="text-muted text-center text-sm">
                Tap "Add Exercise" to get started
              </Text>
            </View>
          ) : (
            <View className="gap-4 mb-4">
              {formData.exercises.map((exercise, index) => (
                <ExerciseCard
                  key={exercise.tempId}
                  exercise={exercise}
                  onUpdate={(updated) => handleUpdateExercise(index, updated)}
                  onRemove={() => handleRemoveExercise(index)}
                  onChangeExercise={() => handleChangeExercise(index)}
                />
              ))}
            </View>
          )}

          <Button onPress={handleAddExercise} variant="secondary" className="mb-4">
            <Button.Label>Add Exercise</Button.Label>
          </Button>
        </View>

        {/* Notes */}
        <View className="px-4 pb-6">
          <Text className="text-sm font-medium text-foreground mb-2">
            Notes (optional)
          </Text>
          <TextInput
            className="border border-border rounded-lg p-3 text-foreground bg-background min-h-[100px]"
            multiline
            numberOfLines={4}
            placeholder="Add any notes about this workout..."
            placeholderTextColor="#999"
            value={formData.notes}
            onChangeText={(text) =>
              setFormData((prev) => ({ ...prev, notes: text }))
            }
            textAlignVertical="top"
          />
        </View>
      </ScrollView>

      {/* Exercise Picker */}
      <ExercisePicker
        isOpen={showExercisePicker}
        onClose={() => setShowExercisePicker(false)}
        onSelect={handleSelectExercise}
      />
    </KeyboardAvoidingView>
  );
}
