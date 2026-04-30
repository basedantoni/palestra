import DateTimePicker from "@react-native-community/datetimepicker";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Button } from "heroui-native";
import { useEffect, useMemo, useRef, useState } from "react";
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
import type {
  ApiTemplateForWorkoutPrefill,
  WorkoutFormData,
} from "@src/api/lib/workout-utils";
import {
  calculateTotalVolume,
  type CardioSubtype,
  type ExerciseType,
  createBlankExercise,
  formatDistance,
  formatVolume,
  formDataToApiInput,
  normalizeDateToLocalNoon,
  reconcileUnknownExerciseNames,
  templateToWorkoutFormData,
  WORKOUT_TYPE_LABELS,
} from "@src/api/lib/workout-utils";

import { ExerciseCard } from "@/components/workout/exercise-card";
import { ExercisePicker } from "@/components/workout/exercise-picker";
import { WhoopActivityPicker } from "@/components/workout/WhoopActivityPicker";

const WORKOUT_TYPES = [
  "weightlifting",
  "hiit",
  "cardio",
  "calisthenics",
  "yoga",
  "sports",
  "mixed",
] as const;

function formatDateDisplay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function NewWorkoutScreen() {
  const { templateId } = useLocalSearchParams<{ templateId?: string }>();
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [editingExerciseIndex, setEditingExerciseIndex] = useState<
    number | null
  >(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(
    templateId,
  );
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | undefined>();

  // Whoop linking state
  const [selectedWhoopActivityId, setSelectedWhoopActivityId] = useState<string | null>(null);
  const [whoopCardOpen, setWhoopCardOpen] = useState(false);

  const [formData, setFormData] = useState<WorkoutFormData>({
    workoutType: "weightlifting",
    exercises: [],
    notes: "",
    templateId: undefined,
    date: new Date(),
  });

  const [showDatePicker, setShowDatePicker] = useState(
    Platform.OS === "ios",
  );

  const templatesQuery = useQuery(trpc.templates.list.queryOptions());
  const templateQuery = useQuery(
    trpc.templates.get.queryOptions(
      { id: selectedTemplateId! },
      { enabled: !!selectedTemplateId },
    ),
  );
  const exercisesQuery = useQuery(trpc.exercises.list.queryOptions());
  const overloadQuery = useQuery(trpc.analytics.progressiveOverload.queryOptions());
  const preferencesQuery = useQuery(trpc.preferences.get.queryOptions());
  const distanceUnit = preferencesQuery.data?.distanceUnit ?? "mi";

  const exerciseNameById = useMemo(() => {
    return Object.fromEntries(
      (exercisesQuery.data ?? []).map((exercise) => [exercise.id, exercise.name]),
    );
  }, [exercisesQuery.data]);

  const suggestionsByExerciseId = useMemo(() => {
    const pairs = (overloadQuery.data ?? []).map((item) => [item.exerciseId, item.suggestion]);
    return Object.fromEntries(pairs);
  }, [overloadQuery.data]);

  // Detect whether any exercise in the form has cardioSubtype === 'running'
  const hasRunningExercise = formData.exercises.some(
    (ex) => ex.cardioSubtype === "running",
  );

  // ISO date string for the Whoop picker (YYYY-MM-DD)
  const workoutDateIso = useMemo(() => {
    const d = formData.date ?? new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [formData.date]);

  // Reset Whoop selection when workout date changes
  const prevDateRef = useRef(workoutDateIso);
  useEffect(() => {
    if (prevDateRef.current !== workoutDateIso) {
      prevDateRef.current = workoutDateIso;
      setSelectedWhoopActivityId(null);
    }
  }, [workoutDateIso]);

  // Clear Whoop selection when no running exercise is present
  useEffect(() => {
    if (!hasRunningExercise && selectedWhoopActivityId !== null) {
      setSelectedWhoopActivityId(null);
      setWhoopCardOpen(false);
    }
  }, [hasRunningExercise, selectedWhoopActivityId]);

  // Fetch activities to show summary of selected activity
  const whoopActivitiesQuery = useQuery(
    trpc.whoop.listUnlinkedCardioActivities.queryOptions(
      { date: workoutDateIso },
      { enabled: hasRunningExercise && whoopCardOpen },
    ),
  );
  const selectedWhoopActivity = useMemo(() => {
    if (!selectedWhoopActivityId) return null;
    return (
      whoopActivitiesQuery.data?.activities.find(
        (a) => a.id === selectedWhoopActivityId,
      ) ?? null
    );
  }, [selectedWhoopActivityId, whoopActivitiesQuery.data]);

  useEffect(() => {
    if (!selectedTemplateId || !templateQuery.data) return;
    if (appliedTemplateId === selectedTemplateId) return;
    setFormData(
      templateToWorkoutFormData(
        templateQuery.data as ApiTemplateForWorkoutPrefill,
        {
          exerciseNameById,
          suggestionsByExerciseId,
          date: new Date(),
        },
      ),
    );
    setAppliedTemplateId(selectedTemplateId);
  }, [
    appliedTemplateId,
    selectedTemplateId,
    templateQuery.data,
    exerciseNameById,
    suggestionsByExerciseId,
  ]);

  useEffect(() => {
    if (!Object.keys(exerciseNameById).length) return;
    setFormData((prev) => reconcileUnknownExerciseNames(prev, exerciseNameById));
  }, [exerciseNameById]);

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

  const handleSelectExercise = (exercise: {
    id: string;
    name: string;
    exerciseType?: string;
    cardioSubtype?: string | null;
  }) => {
    if (editingExerciseIndex !== null) {
      const updatedExercises = [...formData.exercises];
      if (editingExerciseIndex >= updatedExercises.length) {
        // Adding new exercise
        updatedExercises.push({
          ...createBlankExercise(updatedExercises.length),
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          exerciseType: exercise.exerciseType as ExerciseType | undefined,
          cardioSubtype: exercise.cardioSubtype as CardioSubtype | undefined,
        });
      } else {
        // Changing existing exercise — clear Whoop if running subtype changes
        const prevSubtype = updatedExercises[editingExerciseIndex]?.cardioSubtype;
        updatedExercises[editingExerciseIndex] = {
          ...updatedExercises[editingExerciseIndex]!,
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          exerciseType: exercise.exerciseType as ExerciseType | undefined,
          cardioSubtype: exercise.cardioSubtype as CardioSubtype | undefined,
        };
        if (prevSubtype === "running" && exercise.cardioSubtype !== "running") {
          const stillHasRunning = updatedExercises.some(
            (ex, i) => i !== editingExerciseIndex && ex.cardioSubtype === "running",
          );
          if (!stillHasRunning) {
            setSelectedWhoopActivityId(null);
            setWhoopCardOpen(false);
          }
        }
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
    const removedExercise = formData.exercises[index];
    const updatedExercises = formData.exercises
      .filter((_, i) => i !== index)
      .map((ex, i) => ({ ...ex, order: i }));

    if (removedExercise?.cardioSubtype === "running") {
      const stillHasRunning = updatedExercises.some(
        (ex) => ex.cardioSubtype === "running",
      );
      if (!stillHasRunning) {
        setSelectedWhoopActivityId(null);
        setWhoopCardOpen(false);
      }
    }

    setFormData((prev) => ({ ...prev, exercises: updatedExercises }));
  };

  const handleSave = () => {
    const apiInput = formDataToApiInput({
      ...formData,
      whoopActivityId: selectedWhoopActivityId ?? undefined,
    });
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
            Template
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="flex-row gap-2 mb-4"
          >
            <Pressable
              onPress={() => {
                setSelectedTemplateId(undefined);
                setAppliedTemplateId(undefined);
                setFormData((prev) => ({ ...prev, templateId: undefined }));
              }}
              className={
                !selectedTemplateId
                  ? "px-4 py-2 rounded-full bg-primary"
                  : "px-4 py-2 rounded-full bg-secondary"
              }
            >
              <Text
                className={
                  !selectedTemplateId
                    ? "text-primary-foreground text-sm font-medium"
                    : "text-secondary-foreground text-sm"
                }
              >
                No Template
              </Text>
            </Pressable>
            {(templatesQuery.data ?? []).map((template) => (
              <Pressable
                key={template.id}
                onPress={() => setSelectedTemplateId(template.id)}
                className={
                  selectedTemplateId === template.id
                    ? "px-4 py-2 rounded-full bg-primary"
                    : "px-4 py-2 rounded-full bg-secondary"
                }
              >
                <Text
                  className={
                    selectedTemplateId === template.id
                      ? "text-primary-foreground text-sm font-medium"
                      : "text-secondary-foreground text-sm"
                  }
                >
                  {template.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

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

        {/* Workout Date */}
        <View className="px-4 pb-2">
          <Text className="text-sm font-medium text-foreground mb-2">Date</Text>
          {Platform.OS === "android" && (
            <Pressable onPress={() => setShowDatePicker(true)}>
              <Text className="text-foreground text-base py-2 px-3 border border-border rounded-lg">
                {(formData.date ?? new Date()).toLocaleDateString()}
              </Text>
            </Pressable>
          )}
          {showDatePicker && (
            <DateTimePicker
              value={formData.date ?? new Date()}
              mode="date"
              display={Platform.OS === "ios" ? "compact" : "default"}
              maximumDate={new Date()}
              onChange={(_event, selectedDate) => {
                setShowDatePicker(Platform.OS === "ios");
                if (selectedDate) {
                  setFormData((prev) => ({
                    ...prev,
                    date: normalizeDateToLocalNoon(selectedDate),
                  }));
                }
              }}
            />
          )}
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

        {/* Whoop Linking Card — only visible when a running exercise is present */}
        {hasRunningExercise && (
          <View className="mx-4 mb-4 rounded-lg border border-border overflow-hidden">
            {/* Card header */}
            <Pressable
              onPress={() => setWhoopCardOpen((open) => !open)}
              className="flex-row items-center justify-between px-4 py-3"
            >
              <View className="flex-row items-center gap-2">
                <Text className="text-sm font-medium text-foreground">
                  Link Whoop Run
                </Text>
                {selectedWhoopActivity && (
                  <View className="bg-primary/10 rounded px-2 py-0.5">
                    <Text className="text-xs font-medium text-primary">
                      Linked
                    </Text>
                  </View>
                )}
              </View>
              <Text className="text-muted text-base">
                {whoopCardOpen ? "▲" : "▶"}
              </Text>
            </Pressable>

            {/* Selected activity summary when collapsed */}
            {!whoopCardOpen && selectedWhoopActivity && (
              <View className="border-t border-border bg-muted/20 px-4 py-2.5">
                <View className="flex-row items-center justify-between gap-2">
                  <View className="flex-1 min-w-0">
                    <Text className="text-xs text-foreground" numberOfLines={1}>
                      <Text className="font-medium">{selectedWhoopActivity.sportName}</Text>
                      {"  ·  "}
                      {formatDateDisplay(selectedWhoopActivity.start)}
                      {"  ·  "}
                      {selectedWhoopActivity.durationMinutes} min
                      {selectedWhoopActivity.averageHeartRate != null
                        ? `  ·  ${selectedWhoopActivity.averageHeartRate} bpm`
                        : ""}
                      {selectedWhoopActivity.distanceMeter != null
                        ? `  ·  ${formatDistance(selectedWhoopActivity.distanceMeter, distanceUnit)}`
                        : ""}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setSelectedWhoopActivityId(null)}
                    className="pl-2"
                  >
                    <Text className="text-xs text-muted">Remove</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Expanded picker */}
            {whoopCardOpen && (
              <View className="border-t border-border px-4 py-3">
                <WhoopActivityPicker
                  workoutDate={workoutDateIso}
                  selectedActivityId={selectedWhoopActivityId}
                  onSelect={setSelectedWhoopActivityId}
                  distanceUnit={distanceUnit}
                />
              </View>
            )}
          </View>
        )}

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
