import React from "react";
import { View, StyleSheet, Pressable, Text } from "react-native";
import { useThemeColor } from "heroui-native";
import { WORKOUT_TYPES } from "@src/shared";
import { Ionicons } from "@expo/vector-icons";

interface StepWorkoutsProps {
  selectedTypes: string[];
  setSelectedTypes: React.Dispatch<React.SetStateAction<string[]>>;
  errors: { preferredWorkoutTypes?: string };
}

const stepStyles = StyleSheet.create({
  container: {
    gap: 16,
  },
  header: {
    gap: 4,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  card: {
    flexBasis: "47%",
    flexGrow: 0,
    flexShrink: 0,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    gap: 4,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  checkboxContainer: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  cardContent: {
    flex: 1,
    gap: 2,
  },
  cardLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  cardDescription: {
    fontSize: 12,
    opacity: 0.7,
  },
  error: {
    fontSize: 12,
  },
  count: {
    fontSize: 14,
    opacity: 0.7,
  },
});

export default function StepWorkouts({
  selectedTypes,
  setSelectedTypes,
  errors,
}: StepWorkoutsProps) {
  const borderColor = useThemeColor("border");
  const tintColor = useThemeColor("link");
  const backgroundColor = useThemeColor("background");
  const textColor = useThemeColor("foreground");
  const errorColor = useThemeColor("danger");

  const toggleType = (value: string) => {
    setSelectedTypes((prev: string[]) =>
      prev.includes(value)
        ? prev.filter((v: string) => v !== value)
        : [...prev, value]
    );
  };

  return (
    <View style={stepStyles.container}>
      <View style={stepStyles.header}>
        <Text style={stepStyles.label}>
          {"What types of workouts do you do?"}
        </Text>
        <Text style={[stepStyles.subtitle, { color: textColor }]}>
          {"Select all that apply"}
        </Text>
      </View>

      <View style={stepStyles.grid}>
        {WORKOUT_TYPES.map((type) => {
          const isSelected = selectedTypes.includes(type.value);
          return (
            <Pressable
              key={type.value}
              onPress={() => toggleType(type.value)}
              style={[
                stepStyles.card,
                {
                  borderColor: isSelected ? tintColor : borderColor,
                  backgroundColor: isSelected ? `${tintColor}10` : backgroundColor,
                },
              ]}
            >
              <View
                style={[
                  stepStyles.checkboxContainer,
                  {
                    borderColor: isSelected ? tintColor : borderColor,
                    backgroundColor: isSelected ? tintColor : backgroundColor,
                  },
                ]}
              >
                {isSelected ? (
                  <Ionicons name="checkmark" size={14} color="white" />
                ) : null}
              </View>
              <View style={stepStyles.cardContent}>
                <Text style={[stepStyles.cardLabel, { color: textColor }]}>
                  {type.label}
                </Text>
                <Text style={[stepStyles.cardDescription, { color: textColor }]}>
                  {type.description}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {errors.preferredWorkoutTypes ? (
        <Text style={[stepStyles.error, { color: errorColor }]}>
          {errors.preferredWorkoutTypes}
        </Text>
      ) : null}

      {selectedTypes.length > 0 ? (
        <Text style={[stepStyles.count, { color: textColor }]}>
          {`${selectedTypes.length} workout type${selectedTypes.length !== 1 ? "s" : ""} selected`}
        </Text>
      ) : null}
    </View>
  );
}
