import { useMutation, useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Card } from "heroui-native";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import DraggableFlatList, {
  type RenderItemParams,
} from "react-native-draggable-flatlist";

import { Container } from "@/components/container";
import { ExercisePicker } from "@/components/workout/exercise-picker";
import { trpc } from "@/utils/trpc";
import {
  apiTemplateToFormData,
  templateFormToApiInput,
} from "@src/api/lib/template-utils";
import type { TemplateFormData } from "@src/api/lib/template-utils";
import { WORKOUT_TYPE_LABELS } from "@src/api/lib/workout-utils";

function generateTempId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function validateTemplateForm(form: TemplateFormData) {
  const errors: string[] = [];

  if (!form.name.trim()) {
    errors.push("Template name is required.");
  }

  if (form.exercises.length === 0) {
    errors.push("Add at least one exercise.");
  }

  for (let i = 0; i < form.exercises.length; i++) {
    const exercise = form.exercises[i];
    if (!exercise) continue;
    const defaultSets = exercise.defaultSets;
    if (defaultSets != null && (!Number.isInteger(defaultSets) || defaultSets < 1)) {
      errors.push(`Exercise ${i + 1} default sets must be a whole number >= 1.`);
    }
  }

  return errors;
}

export default function TemplateDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [formData, setFormData] = useState<TemplateFormData | null>(null);

  const template = useQuery(trpc.templates.get.queryOptions({ id }));
  const exercises = useQuery(trpc.exercises.list.queryOptions());

  const exerciseNameById = useMemo(() => {
    return Object.fromEntries(
      (exercises.data ?? []).map((exercise) => [exercise.id, exercise.name]),
    );
  }, [exercises.data]);

  useEffect(() => {
    if (template.data) {
      setFormData(apiTemplateToFormData(template.data as any, exerciseNameById));
    }
  }, [template.data, exerciseNameById]);

  const updateTemplate = useMutation(
    trpc.templates.update.mutationOptions({
      onSuccess: () => {
        Alert.alert("Success", "Template updated");
        template.refetch();
      },
      onError: (error) => {
        Alert.alert("Error", error.message || "Failed to update template");
      },
    }),
  );

  if (template.isLoading || !formData) {
    return (
      <Container className="flex-1 justify-center items-center">
        <Text className="text-muted">Loading template...</Text>
      </Container>
    );
  }

  if (!template.data) {
    return (
      <Container className="flex-1 justify-center items-center">
        <Text className="text-muted mb-3">Template not found.</Text>
        <Button onPress={() => router.back()} variant="secondary">
          <Button.Label>Go Back</Button.Label>
        </Button>
      </Container>
    );
  }

  const isEditable = !template.data.isSystemTemplate;
  const validationErrors = validateTemplateForm(formData);
  const canSave = isEditable && validationErrors.length === 0;

  const handleSave = () => {
    if (!isEditable) return;
    if (validationErrors.length > 0) {
      Alert.alert("Fix Template", validationErrors[0] ?? "Please fix form errors.");
      return;
    }
    const payload = templateFormToApiInput(formData);
    updateTemplate.mutate({
      id,
      ...payload,
    });
  };

  const handleSelectExercise = (exercise: { id: string; name: string }) => {
    if (!isEditable) return;
    setFormData({
      ...formData,
      exercises: [
        ...formData.exercises,
        {
          tempId: generateTempId(),
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          order: formData.exercises.length,
          defaultSets: 3,
        },
      ],
    });
    setShowExercisePicker(false);
  };

  const handleRemoveExercise = (index: number) => {
    if (!isEditable) return;
    const nextExercises = formData.exercises
      .filter((_, i) => i !== index)
      .map((exercise, i) => ({ ...exercise, order: i }));
    setFormData({ ...formData, exercises: nextExercises });
  };

  return (
    <Container className="flex-1">
      <ScrollView className="flex-1" contentInsetAdjustmentBehavior="automatic">
        <View className="p-6">
          <View className="mb-4">
            <Text className="text-2xl font-bold text-foreground mb-1">
              {isEditable ? "Edit Template" : "Template"}
            </Text>
            <Text className="text-sm text-muted">
              {isEditable
                ? "Update template details and exercises."
                : "System templates are read-only."}
            </Text>
          </View>

          <Card variant="secondary" className="p-4 mb-4">
            <Text className="text-sm font-medium text-foreground mb-2">Name</Text>
            <TextInput
              className="border border-border rounded-lg px-3 py-2 text-foreground bg-background mb-3"
              editable={isEditable}
              value={formData.name}
              onChangeText={(name) => setFormData({ ...formData, name })}
              placeholder="Template name"
              placeholderTextColor="#999"
            />

            <Text className="text-sm font-medium text-foreground mb-2">
              Workout Type
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
              <View className="flex-row gap-2">
                {Object.entries(WORKOUT_TYPE_LABELS).map(([key, label]) => (
                  <Pressable
                    key={key}
                    disabled={!isEditable}
                    onPress={() =>
                      setFormData({
                        ...formData,
                        workoutType: key as TemplateFormData["workoutType"],
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
                      {String(label)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <Text className="text-sm font-medium text-foreground mb-2">Notes</Text>
            <TextInput
              className="border border-border rounded-lg px-3 py-2 text-foreground bg-background min-h-[90px]"
              editable={isEditable}
              multiline
              value={formData.notes}
              onChangeText={(notes) => setFormData({ ...formData, notes })}
              placeholder="Template notes"
              placeholderTextColor="#999"
              textAlignVertical="top"
            />
          </Card>

          <Card variant="secondary" className="p-4">
            <Text className="text-base font-semibold text-foreground mb-3">
              Exercises
            </Text>

            {formData.exercises.length === 0 ? (
              <Text className="text-muted text-sm">No exercises added yet.</Text>
            ) : (
              <DraggableFlatList
                data={formData.exercises}
                keyExtractor={(item) => item.tempId}
                scrollEnabled={false}
                onDragEnd={({ data }) => {
                  setFormData({
                    ...formData,
                    exercises: data.map((exercise, index) => ({
                      ...exercise,
                      order: index,
                    })),
                  });
                }}
                renderItem={({ item: exercise, getIndex, drag, isActive }: RenderItemParams<
                  TemplateFormData["exercises"][number]
                >) => {
                  const index = getIndex() ?? 0;
                  return (
                    <View
                      className={`border border-border rounded-lg px-3 py-2 mb-2 ${isActive ? "opacity-90" : ""}`}
                    >
                      <View className="flex-row items-center justify-between">
                        <View className="flex-1 pr-2">
                          <Text className="text-sm font-medium text-foreground">
                            {exercise.exerciseName}
                          </Text>
                          <Text className="text-xs text-muted mt-1">
                            Exercise {index + 1}
                          </Text>
                        </View>
                        <View className="flex-row items-center gap-3">
                          {isEditable ? (
                            <Pressable onLongPress={drag} delayLongPress={120}>
                              <Ionicons
                                name="reorder-three-outline"
                                size={22}
                                color="#666"
                              />
                            </Pressable>
                          ) : null}
                          <Pressable
                            disabled={!isEditable}
                            onPress={() => handleRemoveExercise(index)}
                          >
                            <Text className={isEditable ? "text-danger" : "text-muted"}>
                              Remove
                            </Text>
                          </Pressable>
                        </View>
                      </View>

                      <View className="mt-2">
                        <Text className="text-xs text-muted mb-1">Default sets</Text>
                        <TextInput
                          className="border border-border rounded-lg px-3 py-1.5 text-foreground bg-background"
                          editable={isEditable}
                          keyboardType="number-pad"
                          value={exercise.defaultSets?.toString() ?? ""}
                          onChangeText={(text) => {
                            const parsed = text === "" ? undefined : Number(text);
                            const normalized =
                              parsed == null || Number.isNaN(parsed) || parsed <= 0
                                ? undefined
                                : parsed;
                            const nextExercises = [...formData.exercises];
                            nextExercises[index] = {
                              ...exercise,
                              defaultSets: normalized,
                            };
                            setFormData({ ...formData, exercises: nextExercises });
                          }}
                          placeholder="e.g. 3"
                          placeholderTextColor="#999"
                        />
                      </View>
                    </View>
                  );
                }}
              />
            )}

            {isEditable ? (
              <Button
                className="mt-3"
                variant="secondary"
                onPress={() => setShowExercisePicker(true)}
              >
                <Button.Label>Add Exercise</Button.Label>
              </Button>
            ) : null}
          </Card>

          {validationErrors.length > 0 ? (
            <Card variant="secondary" className="p-4 mt-4">
              <Text className="text-sm font-semibold text-foreground mb-2">
                Validation
              </Text>
              {validationErrors.map((error) => (
                <Text key={error} className="text-sm text-danger mb-1">
                  {error}
                </Text>
              ))}
            </Card>
          ) : null}

          <Button
            className="mt-4"
            variant="secondary"
            onPress={() => router.push(`/new-workout?templateId=${id}`)}
          >
            <Button.Label>Start Workout from Template</Button.Label>
          </Button>

          {isEditable ? (
            <Button
              className="mt-3"
              onPress={handleSave}
              isDisabled={updateTemplate.isPending || !canSave}
            >
              <Button.Label>
                {updateTemplate.isPending ? "Saving..." : "Save Template"}
              </Button.Label>
            </Button>
          ) : null}
        </View>
      </ScrollView>

      <ExercisePicker
        isOpen={showExercisePicker}
        onClose={() => setShowExercisePicker(false)}
        onSelect={handleSelectExercise}
      />
    </Container>
  );
}
