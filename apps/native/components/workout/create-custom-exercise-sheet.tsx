import { startTransition, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Chip } from "heroui-native";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { trpc } from "@/utils/trpc";
import { EXERCISE_CATEGORY_LABELS } from "@src/api/lib/workout-utils";

type ExerciseResult = {
  id: string;
  name: string;
  category: string;
};

interface CreateCustomExerciseSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (exercise: { id: string; name: string }) => void;
}

const CATEGORIES = [
  "chest",
  "back",
  "shoulders",
  "arms",
  "legs",
  "core",
  "cardio",
  "other",
] as const;

const EXERCISE_TYPES = [
  "weightlifting",
  "hiit",
  "cardio",
  "calisthenics",
  "yoga",
  "sports",
  "mixed",
] as const;

const EXERCISE_TYPE_LABELS: Record<(typeof EXERCISE_TYPES)[number], string> = {
  weightlifting: "Weightlifting",
  hiit: "HIIT",
  cardio: "Cardio",
  calisthenics: "Calisthenics",
  yoga: "Yoga",
  sports: "Sports",
  mixed: "Mixed",
};

export function CreateCustomExerciseSheet({
  isOpen,
  onClose,
  onCreated,
}: CreateCustomExerciseSheetProps) {
  const [name, setName] = useState("");
  const [category, setCategory] =
    useState<(typeof CATEGORIES)[number]>("other");
  const [exerciseType, setExerciseType] =
    useState<(typeof EXERCISE_TYPES)[number]>("weightlifting");
  const [linkedExerciseQuery, setLinkedExerciseQuery] = useState("");
  const [linkedExerciseSearch, setLinkedExerciseSearch] = useState("");
  const [linkedExercise, setLinkedExercise] =
    useState<ExerciseResult | null>(null);
  const [showLinkedResults, setShowLinkedResults] = useState(false);

  const { data: linkedSearchResults } = useQuery(
    trpc.exercises.search.queryOptions(
      linkedExerciseSearch ? { query: linkedExerciseSearch } : undefined,
      { enabled: linkedExerciseSearch.length > 0 },
    ),
  );

  const createMutation = useMutation(
    trpc.exercises.createCustom.mutationOptions({
      onSuccess: (created) => {
        Alert.alert(
          "Submitted",
          `"${created.name}" has been submitted for review.`,
        );
        onCreated?.(created);
        handleClose();
      },
      onError: (err) => {
        Alert.alert("Error", err.message || "Failed to create exercise");
      },
    }),
  );

  const handleClose = () => {
    setName("");
    setCategory("other");
    setExerciseType("weightlifting");
    setLinkedExerciseQuery("");
    setLinkedExerciseSearch("");
    setLinkedExercise(null);
    setShowLinkedResults(false);
    onClose();
  };

  const handleLinkedSearchChange = (value: string) => {
    setLinkedExerciseQuery(value);
    startTransition(() => {
      setLinkedExerciseSearch(value);
      setShowLinkedResults(value.length > 0);
    });
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      Alert.alert("Validation Error", "Exercise name is required.");
      return;
    }
    createMutation.mutate({
      name: name.trim(),
      category,
      exerciseType,
      linkedExerciseId: linkedExercise?.id,
    });
  };

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <ScrollView className="flex-1 bg-background">
        {/* Header */}
        <View className="flex-row items-center justify-between p-4 border-b border-border">
          <Text className="text-xl font-bold text-foreground">
            Create Custom Exercise
          </Text>
          <Pressable onPress={handleClose} className="p-2">
            <Ionicons name="close" size={24} color="#666" />
          </Pressable>
        </View>

        <View className="p-4 gap-5">
          {/* Name */}
          <View>
            <Text className="text-sm font-medium text-foreground mb-1">
              Name
            </Text>
            <TextInput
              className="border border-border rounded-lg px-4 py-3 text-foreground bg-background"
              placeholder="e.g. Zercher Squat"
              placeholderTextColor="#999"
              value={name}
              onChangeText={setName}
            />
          </View>

          {/* Category */}
          <View>
            <Text className="text-sm font-medium text-foreground mb-2">
              Category
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {CATEGORIES.map((cat) => (
                <Pressable key={cat} onPress={() => setCategory(cat)}>
                  <Chip
                    variant={category === cat ? "primary" : "secondary"}
                    className="mr-2"
                  >
                    <Chip.Label>
                      {EXERCISE_CATEGORY_LABELS[cat] ?? cat}
                    </Chip.Label>
                  </Chip>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* Exercise Type */}
          <View>
            <Text className="text-sm font-medium text-foreground mb-2">
              Exercise Type
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {EXERCISE_TYPES.map((type) => (
                <Pressable key={type} onPress={() => setExerciseType(type)}>
                  <Chip
                    variant={exerciseType === type ? "primary" : "secondary"}
                    className="mr-2"
                  >
                    <Chip.Label>{EXERCISE_TYPE_LABELS[type]}</Chip.Label>
                  </Chip>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* Linked Exercise */}
          <View>
            <Text className="text-sm font-medium text-foreground mb-1">
              Linked Exercise (optional)
            </Text>
            <Text className="text-xs text-muted-foreground mb-2">
              Link to a similar public exercise as a movement-pattern reference.
            </Text>
            {linkedExercise ? (
              <View className="flex-row items-center gap-2">
                <View className="bg-secondary px-3 py-1 rounded">
                  <Text className="text-xs text-secondary-foreground">
                    {linkedExercise.name}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    setLinkedExercise(null);
                    setLinkedExerciseQuery("");
                    setLinkedExerciseSearch("");
                  }}
                >
                  <Text className="text-xs text-muted-foreground">Remove</Text>
                </Pressable>
              </View>
            ) : (
              <View>
                <TextInput
                  className="border border-border rounded-lg px-4 py-3 text-foreground bg-background"
                  placeholder="Search exercises to link..."
                  placeholderTextColor="#999"
                  value={linkedExerciseQuery}
                  onChangeText={handleLinkedSearchChange}
                />
                {showLinkedResults &&
                  linkedSearchResults &&
                  linkedSearchResults.length > 0 ? (
                  <View className="border border-border bg-background mt-1 rounded-lg max-h-48">
                    <FlatList
                      data={linkedSearchResults.slice(0, 5)}
                      keyExtractor={(item) => item.id}
                      renderItem={({ item }) => (
                        <Pressable
                          className="px-4 py-3 border-b border-border"
                          onPress={() => {
                            setLinkedExercise(item);
                            setLinkedExerciseQuery("");
                            setLinkedExerciseSearch("");
                            setShowLinkedResults(false);
                          }}
                        >
                          <Text className="text-sm text-foreground">
                            {item.name}
                          </Text>
                        </Pressable>
                      )}
                      nestedScrollEnabled
                    />
                  </View>
                ) : null}
              </View>
            )}
          </View>

          {/* Submit Button */}
          <Pressable
            onPress={handleSubmit}
            disabled={createMutation.isPending || !name.trim()}
            className="bg-primary rounded-lg py-4 items-center disabled:opacity-50"
          >
            <Text className="text-primary-foreground font-semibold">
              {createMutation.isPending ? "Submitting..." : "Submit for Review"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Modal>
  );
}
