import React from "react";
import { View, StyleSheet } from "react-native";
import { useThemeColor } from "heroui-native";

interface OnboardingProgressProps {
  currentStep: number;
  totalSteps: number;
}

const progressStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    flex: 1,
  },
});

export default function OnboardingProgress({ currentStep, totalSteps }: OnboardingProgressProps) {
  const activeColor = useThemeColor("link");
  const inactiveColor = useThemeColor("muted");

  return (
    <View style={progressStyles.container}>
      {Array.from({ length: totalSteps }, (_, i) => (
        <View
          key={i}
          style={[
            progressStyles.dot,
            { backgroundColor: i <= currentStep ? activeColor : inactiveColor },
          ]}
        />
      ))}
    </View>
  );
}
