import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Card } from "heroui-native";
import { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";

import { Container } from "@/components/container";
import { ExerciseCard } from "@/components/workout/exercise-card";
import { ExercisePicker } from "@/components/workout/exercise-picker";
import { WhoopActivityPicker } from "@/components/workout/WhoopActivityPicker";
import { trpc } from "@/utils/trpc";
import {
  type ApiWorkoutForEdit,
  apiWorkoutToFormData,
  calculateSetVolume,
  calculateTotalVolume,
  createBlankExercise,
  derivePace,
  formatDistance,
  formatVolume,
  formDataToApiInput,
  metersToDisplayUnit,
  WORKOUT_TYPE_LABELS,
} from "@src/api/lib/workout-utils";
import type { WorkoutFormData } from "@src/api/lib/workout-utils";

// ── HR Zone chart (native) ────────────────────────────────────────────────────

const HR_ZONE_COLORS = [
  "#9ca3af", // Zone 0 — gray
  "#3b82f6", // Zone 1 — blue
  "#22c55e", // Zone 2 — green
  "#eab308", // Zone 3 — yellow
  "#f97316", // Zone 4 — orange
  "#ef4444", // Zone 5 — red
] as const;

const HR_ZONE_LABELS = [
  "Zone 0",
  "Zone 1",
  "Zone 2",
  "Zone 3",
  "Zone 4",
  "Zone 5",
] as const;

interface HrZoneDurations {
  zone_zero_milli?: number;
  zone_one_milli?: number;
  zone_two_milli?: number;
  zone_three_milli?: number;
  zone_four_milli?: number;
  zone_five_milli?: number;
}

function HrZoneChart({ zones }: { zones: HrZoneDurations }) {
  const values = [
    zones.zone_zero_milli ?? 0,
    zones.zone_one_milli ?? 0,
    zones.zone_two_milli ?? 0,
    zones.zone_three_milli ?? 0,
    zones.zone_four_milli ?? 0,
    zones.zone_five_milli ?? 0,
  ];

  const total = values.reduce((s, v) => s + v, 0);
  if (total === 0) return null;

  return (
    <View className="gap-2 mt-2">
      {values.map((ms, i) => {
        const pct = total > 0 ? Math.round((ms / total) * 100) : 0;
        if (pct === 0) return null;
        return (
          <View key={i} className="flex-row items-center gap-2">
            <Text className="text-xs text-muted w-14">{HR_ZONE_LABELS[i]}</Text>
            <View className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
              <View
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  backgroundColor: HR_ZONE_COLORS[i],
                  borderRadius: 999,
                }}
              />
            </View>
            <Text className="text-xs text-muted w-9 text-right">{pct}%</Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Whoop section (native) ────────────────────────────────────────────────────

interface WhoopSectionProps {
  workoutId: string;
  workoutDate: string; // ISO date "yyyy-MM-dd"
  whoopActivityId: string | null | undefined;
  runningLog: {
    distanceMeter: number | null;
    durationSeconds: number | null;
    heartRate: number | null;
    intensity: number | null;
    hrZoneDurations: HrZoneDurations | null;
  } | null;
  distanceUnit: "mi" | "km";
}

function WhoopSection({
  workoutId,
  workoutDate,
  whoopActivityId,
  runningLog,
  distanceUnit,
}: WhoopSectionProps) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);

  const linkMutation = useMutation(
    trpc.whoop.linkToWorkout.mutationOptions({
      onSuccess: (data) => {
        if (data.metricConflict) {
          // Show conflict alert
          Alert.alert(
            "Overwrite existing metrics?",
            "This workout already has heart rate or intensity data. Linking this Whoop activity will overwrite those values.",
            [
              {
                text: "Keep My Data",
                style: "cancel",
                onPress: () => setPickerOpen(false),
              },
              {
                text: "Use Whoop Data",
                onPress: () => {
                  if (selectedActivityId) {
                    linkForced.mutate({
                      workoutId,
                      whoopActivityId: selectedActivityId,
                      force: true,
                    });
                  }
                },
              },
            ],
          );
          return;
        }
        setPickerOpen(false);
        setSelectedActivityId(null);
        queryClient.invalidateQueries({
          queryKey: trpc.workouts.get.queryOptions({ id: workoutId }).queryKey,
        });
      },
      onError: (err) => {
        Alert.alert("Error", err.message || "Failed to link Whoop run");
      },
    }),
  );

  const linkForced = useMutation(
    trpc.whoop.linkToWorkout.mutationOptions({
      onSuccess: () => {
        setPickerOpen(false);
        setSelectedActivityId(null);
        queryClient.invalidateQueries({
          queryKey: trpc.workouts.get.queryOptions({ id: workoutId }).queryKey,
        });
      },
      onError: (err) => {
        Alert.alert("Error", err.message || "Failed to link Whoop run");
      },
    }),
  );

  const unlinkMutation = useMutation(
    trpc.whoop.unlinkFromWorkout.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.workouts.get.queryOptions({ id: workoutId }).queryKey,
        });
      },
      onError: (err) => {
        Alert.alert("Error", err.message || "Failed to unlink Whoop run");
      },
    }),
  );

  const handleLink = () => {
    if (!selectedActivityId) return;
    linkMutation.mutate({ workoutId, whoopActivityId: selectedActivityId });
  };

  const handleUnlinkPress = () => {
    Alert.alert(
      "Unlink Whoop run?",
      "This will remove the Whoop activity link and clear all Whoop-sourced metrics from this workout.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unlink",
          style: "destructive",
          onPress: () => unlinkMutation.mutate({ workoutId }),
        },
      ],
    );
  };

  const isLinked = !!whoopActivityId;
  const pace = derivePace(runningLog?.distanceMeter ?? null, runningLog?.durationSeconds ?? null, distanceUnit);

  return (
    <>
      <View className="mx-6 mt-2 mb-4">
        <View className="border border-border rounded-xl overflow-hidden">
          {/* Section header */}
          <View className="px-4 py-3 flex-row items-center justify-between border-b border-border bg-secondary/30">
            <Text className="text-sm font-semibold text-foreground">Whoop</Text>
            {isLinked && (
              <View className="bg-red-500/10 rounded-full px-2 py-0.5">
                <Text className="text-[10px] font-medium text-red-600">Linked</Text>
              </View>
            )}
          </View>

          <View className="p-4">
            {isLinked ? (
              <>
                {/* Metrics grid */}
                {runningLog ? (
                  <View className="gap-3">
                    <View className="flex-row flex-wrap gap-x-6 gap-y-3">
                      {runningLog.distanceMeter != null && (
                        <View>
                          <Text className="text-xs text-muted">Distance</Text>
                          <Text className="text-sm font-medium text-foreground">
                            {formatDistance(runningLog.distanceMeter, distanceUnit)}
                          </Text>
                        </View>
                      )}
                      {pace != null && (
                        <View>
                          <Text className="text-xs text-muted">Pace</Text>
                          <Text className="text-sm font-medium text-foreground">{pace}</Text>
                        </View>
                      )}
                      {runningLog.heartRate != null && (
                        <View>
                          <Text className="text-xs text-muted">Avg HR</Text>
                          <Text className="text-sm font-medium text-foreground">
                            {runningLog.heartRate} bpm
                          </Text>
                        </View>
                      )}
                      {runningLog.intensity != null && (
                        <View>
                          <Text className="text-xs text-muted">Strain</Text>
                          <Text className="text-sm font-medium text-foreground">
                            {runningLog.intensity}
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* HR Zone chart */}
                    {runningLog.hrZoneDurations && (
                      <>
                        <Text className="text-xs font-medium text-muted mt-1">HR Zones</Text>
                        <HrZoneChart zones={runningLog.hrZoneDurations} />
                      </>
                    )}
                  </View>
                ) : (
                  <Text className="text-sm text-muted">
                    Whoop metrics not available for this workout.
                  </Text>
                )}

                {/* Unlink button */}
                <Pressable
                  onPress={handleUnlinkPress}
                  disabled={unlinkMutation.isPending}
                  className="mt-4 flex-row items-center gap-1"
                >
                  <Text className="text-xs text-muted">
                    {unlinkMutation.isPending ? "Unlinking…" : "Unlink Whoop run"}
                  </Text>
                </Pressable>
              </>
            ) : (
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-muted">No Whoop run linked</Text>
                <Pressable
                  onPress={() => setPickerOpen(true)}
                  className="px-3 py-1.5 rounded-lg border border-border bg-card"
                >
                  <Text className="text-sm text-foreground font-medium">Link Run</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Picker modal */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View className="flex-1 bg-background">
          {/* Modal header */}
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
            <Pressable onPress={() => setPickerOpen(false)}>
              <Text className="text-sm text-muted">Cancel</Text>
            </Pressable>
            <Text className="text-base font-semibold text-foreground">Link Whoop Run</Text>
            <Pressable
              onPress={handleLink}
              disabled={!selectedActivityId || linkMutation.isPending}
            >
              <Text
                className={[
                  "text-sm font-medium",
                  !selectedActivityId || linkMutation.isPending
                    ? "text-muted"
                    : "text-primary",
                ].join(" ")}
              >
                {linkMutation.isPending ? "Linking…" : "Link"}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            className="flex-1 px-4 pt-4"
            contentInsetAdjustmentBehavior="automatic"
          >
            <Text className="text-xs text-muted mb-3">
              Select a Whoop activity within 3 days of this workout.
            </Text>
            <WhoopActivityPicker
              workoutDate={workoutDate}
              selectedActivityId={selectedActivityId}
              onSelect={setSelectedActivityId}
              distanceUnit={distanceUnit}
            />
            <View className="h-8" />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [isEditing, setIsEditing] = useState(false);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [editingExerciseIndex, setEditingExerciseIndex] = useState<number | null>(
    null,
  );
  const [formData, setFormData] = useState<WorkoutFormData | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(Platform.OS === "ios");
  const [showTemplateNameModal, setShowTemplateNameModal] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const { data: workout, isLoading, refetch } = useQuery(
    trpc.workouts.get.queryOptions({ id }),
  );

  const { data: preferences } = useQuery(trpc.preferences.get.queryOptions());
  const distanceUnit = preferences?.distanceUnit ?? "mi";

  useEffect(() => {
    if (workout) {
      setFormData(apiWorkoutToFormData(workout as ApiWorkoutForEdit));
    }
  }, [workout]);

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

  const updateWorkout = useMutation(
    trpc.workouts.update.mutationOptions({
      onSuccess: async () => {
        setIsEditing(false);
        Alert.alert("Success", "Workout updated");
        await refetch();
      },
      onError: (error) => {
        Alert.alert("Error", error.message || "Failed to update workout");
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
    setTemplateName(`${formatDate(workout?.date ?? new Date())} Template`);
    setShowTemplateNameModal(true);
  };

  const handleConfirmSaveAsTemplate = () => {
    const trimmedName = templateName.trim();
    if (!trimmedName) {
      Alert.alert("Template name required", "Please enter a template name.");
      return;
    }
    saveAsTemplate.mutate({ workoutId: id, name: trimmedName });
    setShowTemplateNameModal(false);
  };

  const handleStartEdit = () => {
    if (!workout) return;
    setFormData(apiWorkoutToFormData(workout as ApiWorkoutForEdit));
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    if (workout) {
      setFormData(apiWorkoutToFormData(workout as ApiWorkoutForEdit));
    }
    setIsEditing(false);
  };

  const handleAddExercise = () => {
    if (!formData) return;
    setEditingExerciseIndex(formData.exercises.length);
    setShowExercisePicker(true);
  };

  const handleChangeExercise = (index: number) => {
    setEditingExerciseIndex(index);
    setShowExercisePicker(true);
  };

  const handleSelectExercise = (exercise: { id: string; name: string }) => {
    if (!formData || editingExerciseIndex === null) return;

    const updatedExercises = [...formData.exercises];
    if (editingExerciseIndex >= updatedExercises.length) {
      updatedExercises.push({
        ...createBlankExercise(updatedExercises.length),
        exerciseId: exercise.id,
        exerciseName: exercise.name,
      });
    } else {
      updatedExercises[editingExerciseIndex] = {
        ...updatedExercises[editingExerciseIndex],
        exerciseId: exercise.id,
        exerciseName: exercise.name,
      };
    }

    setFormData({ ...formData, exercises: updatedExercises });
    setShowExercisePicker(false);
  };

  const handleUpdateExercise = (
    index: number,
    updated: WorkoutFormData["exercises"][0],
  ) => {
    if (!formData) return;
    const updatedExercises = [...formData.exercises];
    updatedExercises[index] = updated;
    setFormData({ ...formData, exercises: updatedExercises });
  };

  const handleRemoveExercise = (index: number) => {
    if (!formData) return;
    const updatedExercises = formData.exercises
      .filter((_, i) => i !== index)
      .map((ex, i) => ({ ...ex, order: i }));
    setFormData({ ...formData, exercises: updatedExercises });
  };

  const handleSaveEdit = () => {
    if (!formData) return;
    const payload = formDataToApiInput(formData);
    updateWorkout.mutate({ id, ...payload });
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

  // Determine if any exercise log has cardioSubtype === 'running'
  const hasRunningExercise = workout.logs.some(
    (log) => (log.exercise as any)?.cardioSubtype === "running",
  );

  // Find the first running exercise log
  const firstRunningLog = hasRunningExercise
    ? (workout.logs.find((log) => (log.exercise as any)?.cardioSubtype === "running") ?? null)
    : null;

  const whoopRunningLog = firstRunningLog
    ? {
        distanceMeter: firstRunningLog.distanceMeter,
        durationSeconds: firstRunningLog.durationSeconds,
        heartRate: firstRunningLog.heartRate,
        intensity: firstRunningLog.intensity,
        hrZoneDurations: ((firstRunningLog as any).hrZoneDurations ?? null) as HrZoneDurations | null,
      }
    : null;

  // ISO date string for picker
  const workoutDate = new Date(workout.date);
  const workoutDateStr = `${workoutDate.getFullYear()}-${String(workoutDate.getMonth() + 1).padStart(2, "0")}-${String(workoutDate.getDate()).padStart(2, "0")}`;

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
            {isEditing ? (
              <View className="flex-row items-center gap-3">
                <Pressable onPress={handleCancelEdit}>
                  <Text className="text-sm text-primary">Cancel</Text>
                </Pressable>
                <Pressable onPress={handleSaveEdit}>
                  <Text className="text-sm text-primary font-medium">
                    {updateWorkout.isPending ? "Saving..." : "Save"}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View className="flex-row items-center gap-3">
                <Pressable onPress={handleStartEdit}>
                  <Ionicons name="create-outline" size={24} color="#999" />
                </Pressable>
                <Pressable onPress={handleDelete}>
                  <Ionicons name="trash-outline" size={24} color="#999" />
                </Pressable>
              </View>
            )}
          </View>

          {isEditing && formData ? (
            <View className="mb-4 gap-3">
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-2">
                  {Object.entries(WORKOUT_TYPE_LABELS).map(([key, label]) => (
                    <Pressable
                      key={key}
                      onPress={() =>
                        setFormData({
                          ...formData,
                          workoutType: key as WorkoutFormData["workoutType"],
                        })
                      }
                      className={
                        formData.workoutType === key
                          ? "px-3 py-1 rounded-full bg-primary"
                          : "px-3 py-1 rounded-full bg-secondary"
                      }
                    >
                      <Text
                        className={
                          formData.workoutType === key
                            ? "text-primary-foreground text-sm font-medium"
                            : "text-secondary-foreground text-sm"
                        }
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

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
                      setFormData({ ...formData, date: selectedDate });
                    }
                  }}
                />
              )}
            </View>
          ) : (
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
              {workout.whoopActivityId && !isEditing ? (
                <View className="bg-red-500/10 px-3 py-1 rounded-full">
                  <Text className="text-[11px] font-medium text-red-600">
                    Linked to Whoop
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          {isEditing && formData ? (
            <TextInput
              className="border border-border rounded-lg p-3 text-foreground bg-background min-h-[100px]"
              multiline
              placeholder="Add any notes about this workout..."
              placeholderTextColor="#999"
              value={formData.notes}
              onChangeText={(text) => setFormData({ ...formData, notes: text })}
              textAlignVertical="top"
            />
          ) : workout.notes ? (
            <View className="bg-secondary p-3 rounded-lg mb-4">
              <Text className="text-sm text-secondary-foreground">
                {workout.notes}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Exercises */}
        <View className="px-6 pb-6">
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-lg font-semibold text-foreground">Exercises</Text>
            {isEditing && formData && calculateTotalVolume(formData.exercises) > 0 ? (
              <Text className="text-sm text-muted">
                Total Volume: {formatVolume(calculateTotalVolume(formData.exercises))}
              </Text>
            ) : null}
          </View>

          {isEditing && formData ? (
            <View className="gap-4">
              {formData.exercises.map((exercise, index) => (
                <ExerciseCard
                  key={exercise.tempId}
                  exercise={exercise}
                  onUpdate={(updated) => handleUpdateExercise(index, updated)}
                  onRemove={() => handleRemoveExercise(index)}
                  onChangeExercise={() => handleChangeExercise(index)}
                />
              ))}

              <Button onPress={handleAddExercise} variant="secondary">
                <Button.Label>Add Exercise</Button.Label>
              </Button>
            </View>
          ) : workout.logs && workout.logs.length > 0 ? (
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
                      durationSeconds: set.durationSeconds ?? undefined,
                    }),
                  0,
                );

                const pace = derivePace(
                  log.distanceMeter,
                  log.durationSeconds,
                  distanceUnit,
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

                    {/* Cardio metrics */}
                    {log.distanceMeter != null || log.durationSeconds != null || log.heartRate != null ? (
                      <View className="flex-row flex-wrap gap-x-4 gap-y-1 mb-3">
                        {log.distanceMeter != null ? (
                          <Text className="text-sm text-muted">
                            {formatDistance(log.distanceMeter, distanceUnit)}
                          </Text>
                        ) : null}
                        {pace != null ? (
                          <Text className="text-sm text-muted">{pace}</Text>
                        ) : null}
                        {log.durationSeconds != null ? (
                          <Text className="text-sm text-muted">
                            {Math.floor(log.durationSeconds / 60)}m {log.durationSeconds % 60}s
                          </Text>
                        ) : null}
                        {log.heartRate != null ? (
                          <Text className="text-sm text-muted">
                            {log.heartRate} bpm avg
                          </Text>
                        ) : null}
                      </View>
                    ) : null}

                    {log.sets && log.sets.length > 0 ? (
                      <View>
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

        {/* Whoop section — only for workouts with running exercises */}
        {!isEditing && hasRunningExercise && (
          <WhoopSection
            workoutId={id}
            workoutDate={workoutDateStr}
            whoopActivityId={workout.whoopActivityId}
            runningLog={whoopRunningLog}
            distanceUnit={distanceUnit}
          />
        )}

        {/* Actions */}
        <View className="px-6 pb-8 gap-3">
          {!isEditing ? (
            <Button
              onPress={handleSaveAsTemplate}
              variant="secondary"
              isDisabled={saveAsTemplate.isPending}
            >
              <Button.Label>
                {saveAsTemplate.isPending ? "Saving..." : "Save as Template"}
              </Button.Label>
            </Button>
          ) : null}
        </View>
      </ScrollView>

      <Modal
        visible={showTemplateNameModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTemplateNameModal(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-md rounded-xl bg-background p-4 border border-border">
            <Text className="text-base font-semibold text-foreground mb-1">
              Save as Template
            </Text>
            <Text className="text-sm text-muted mb-3">
              Enter a name for this template
            </Text>
            <TextInput
              className="border border-border rounded-lg px-3 py-2 text-foreground bg-background"
              value={templateName}
              onChangeText={setTemplateName}
              placeholder="Template name"
              placeholderTextColor="#999"
              autoFocus
            />
            <View className="mt-4 flex-row justify-end gap-2">
              <Button
                variant="secondary"
                onPress={() => setShowTemplateNameModal(false)}
              >
                <Button.Label>Cancel</Button.Label>
              </Button>
              <Button
                onPress={handleConfirmSaveAsTemplate}
                isDisabled={saveAsTemplate.isPending}
              >
                <Button.Label>
                  {saveAsTemplate.isPending ? "Saving..." : "Save"}
                </Button.Label>
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      <ExercisePicker
        isOpen={showExercisePicker}
        onClose={() => setShowExercisePicker(false)}
        onSelect={handleSelectExercise}
      />
    </Container>
  );
}
