import { useQuery } from "@tanstack/react-query";
import { Chip } from "heroui-native";
import { useState } from "react";
import {
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
import { CreateCustomExerciseSheet } from "./create-custom-exercise-sheet";

interface ExercisePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (exercise: { id: string; name: string; exerciseType?: string; cardioSubtype?: string | null }) => void;
}

const CATEGORIES = [
  "all",
  "chest",
  "back",
  "shoulders",
  "arms",
  "legs",
  "core",
  "cardio",
  "other",
] as const;

export function ExercisePicker({ isOpen, onClose, onSelect }: ExercisePickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(
    undefined,
  );
  const [showCreateCustom, setShowCreateCustom] = useState(false);

  const { data: exercises, isLoading } = useQuery(
    trpc.exercises.search.queryOptions({
      query: searchQuery || undefined,
      category: categoryFilter as any,
    }),
  );

  const handleSelectExercise = (exercise: { id: string; name: string; exerciseType?: string; cardioSubtype?: string | null }) => {
    onSelect(exercise);
    setSearchQuery("");
    setCategoryFilter(undefined);
    onClose();
  };

  return (
    <>
    <Modal
      visible={isOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-background">
        {/* Header */}
        <View className="flex-row items-center justify-between p-4 border-b border-border">
          <Text className="text-xl font-bold text-foreground">
            Select Exercise
          </Text>
          <Pressable onPress={onClose} className="p-2">
            <Ionicons name="close" size={24} color="#666" />
          </Pressable>
        </View>

        <View className="flex-1 px-4 pt-4">
          {/* Search Input */}
          <TextInput
            className="border border-border rounded-lg px-4 py-3 mb-3 text-foreground bg-background"
            placeholder="Search exercises..."
            placeholderTextColor="#999"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />

          {/* Category Filters */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mb-4"
            contentContainerStyle={{ gap: 8 }}
          >
            {CATEGORIES.map((cat) => (
              <Pressable
                key={cat}
                onPress={() =>
                  setCategoryFilter(cat === "all" ? undefined : cat)
                }
              >
                <Chip
                  variant={
                    (cat === "all" && !categoryFilter) ||
                    categoryFilter === cat
                      ? "primary"
                      : "secondary"
                  }
                  className="mr-2"
                >
                  <Chip.Label>
                    {cat === "all" ? "All" : EXERCISE_CATEGORY_LABELS[cat] || cat}
                  </Chip.Label>
                </Chip>
              </Pressable>
            ))}
          </ScrollView>

          {/* Exercise List */}
          {isLoading ? (
            <View className="flex-1 justify-center items-center">
              <Text className="text-muted">Loading exercises...</Text>
            </View>
          ) : exercises && exercises.length > 0 ? (
            <FlatList
              data={exercises}
              keyExtractor={(item: any) => item.id}
              renderItem={({ item }: { item: any }) => (
                <Pressable
                  onPress={() => handleSelectExercise(item)}
                  className="py-4 border-b border-border"
                >
                  <Text className="text-base font-medium text-foreground mb-1">
                    {item.name}
                  </Text>
                  <View className="flex-row items-center gap-2">
                    <View className="bg-secondary px-2 py-0.5 rounded">
                      <Text className="text-xs text-secondary-foreground">
                        {EXERCISE_CATEGORY_LABELS[item.category] || item.category}
                      </Text>
                    </View>
                    {item.isCustom ? (
                      <View className="bg-primary/10 px-2 py-0.5 rounded">
                        <Text className="text-xs text-primary">Custom</Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              )}
              ListFooterComponent={
                <Pressable
                  onPress={() => setShowCreateCustom(true)}
                  className="py-4 items-center"
                >
                  <Text className="text-primary text-sm">
                    Can't find your exercise? Create a custom one
                  </Text>
                </Pressable>
              }
              contentContainerStyle={{ paddingBottom: 100 }}
            />
          ) : (
            <View className="flex-1 justify-center items-center gap-3">
              <Text className="text-muted text-center">No exercises found</Text>
              <Pressable onPress={() => setShowCreateCustom(true)}>
                <Text className="text-primary text-sm">
                  Can't find your exercise? Create a custom one
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
    <CreateCustomExerciseSheet
      isOpen={showCreateCustom}
      onClose={() => setShowCreateCustom(false)}
      onCreated={(exercise) => {
        handleSelectExercise(exercise);
        setShowCreateCustom(false);
      }}
    />
    </>
  );
}
