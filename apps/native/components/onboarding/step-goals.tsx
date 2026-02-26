import React from "react";
import { View, StyleSheet, Pressable, Text } from "react-native";
import { useThemeColor } from "heroui-native";
import { GOALS, EXPERIENCE_LEVELS } from "@/lib/onboarding-schemas";

interface StepGoalsProps {
  fitnessGoal: string;
  setFitnessGoal: (goal: string) => void;
  experienceLevel: string;
  setExperienceLevel: (level: string) => void;
  errors: { fitnessGoal?: string; experienceLevel?: string };
}

const stepStyles = StyleSheet.create({
  container: {
    gap: 24,
  },
  section: {
    gap: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
  },
  grid2: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  grid3: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  card2: {
    flexBasis: "47%",
    flexGrow: 0,
    flexShrink: 0,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    gap: 4,
  },
  card3: {
    flexBasis: "30%",
    flexGrow: 0,
    flexShrink: 0,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    gap: 4,
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
    marginTop: 4,
  },
});

export default function StepGoals({
  fitnessGoal,
  setFitnessGoal,
  experienceLevel,
  setExperienceLevel,
  errors,
}: StepGoalsProps) {
  const borderColor = useThemeColor("border");
  const tintColor = useThemeColor("link");
  const backgroundColor = useThemeColor("background");
  const textColor = useThemeColor("foreground");
  const errorColor = useThemeColor("danger");

  return (
    <View style={stepStyles.container}>
      <View style={stepStyles.section}>
        <Text style={stepStyles.label}>
          {"What's your primary fitness goal?"}
        </Text>
        <View style={stepStyles.grid2}>
          {GOALS.map((goal) => {
            const isSelected = fitnessGoal === goal.value;
            return (
              <Pressable
                key={goal.value}
                onPress={() => setFitnessGoal(goal.value)}
                style={[
                  stepStyles.card2,
                  {
                    borderColor: isSelected ? tintColor : borderColor,
                    backgroundColor: isSelected ? `${tintColor}10` : backgroundColor,
                  },
                ]}
              >
                <Text style={[stepStyles.cardLabel, { color: textColor }]}>
                  {goal.label}
                </Text>
                <Text style={[stepStyles.cardDescription, { color: textColor }]}>
                  {goal.description}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {errors.fitnessGoal ? (
          <Text style={[stepStyles.error, { color: errorColor }]}>
            {errors.fitnessGoal}
          </Text>
        ) : null}
      </View>

      <View style={stepStyles.section}>
        <Text style={stepStyles.label}>
          {"What's your experience level?"}
        </Text>
        <View style={stepStyles.grid3}>
          {EXPERIENCE_LEVELS.map((level) => {
            const isSelected = experienceLevel === level.value;
            return (
              <Pressable
                key={level.value}
                onPress={() => setExperienceLevel(level.value)}
                style={[
                  stepStyles.card3,
                  {
                    borderColor: isSelected ? tintColor : borderColor,
                    backgroundColor: isSelected ? `${tintColor}10` : backgroundColor,
                  },
                ]}
              >
                <Text style={[stepStyles.cardLabel, { color: textColor }]}>
                  {level.label}
                </Text>
                <Text style={[stepStyles.cardDescription, { color: textColor }]}>
                  {level.description}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {errors.experienceLevel ? (
          <Text style={[stepStyles.error, { color: errorColor }]}>
            {errors.experienceLevel}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
