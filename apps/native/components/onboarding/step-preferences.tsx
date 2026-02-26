import React from "react";
import { View, StyleSheet, Pressable, Text } from "react-native";
import { useThemeColor } from "heroui-native";
import { WEIGHT_UNITS, DISTANCE_UNITS, MUSCLE_GROUP_SYSTEMS, THEMES } from "@/lib/onboarding-schemas";

interface StepPreferencesProps {
  weightUnit: string;
  setWeightUnit: (unit: string) => void;
  distanceUnit: string;
  setDistanceUnit: (unit: string) => void;
  muscleGroupSystem: string;
  setMuscleGroupSystem: (system: string) => void;
  theme: string;
  setTheme: (theme: string) => void;
  errors: {
    weightUnit?: string;
    distanceUnit?: string;
    muscleGroupSystem?: string;
    theme?: string;
  };
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
    gap: 12,
  },
  grid3: {
    flexDirection: "row",
    gap: 12,
  },
  card2: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  card3: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  cardFull: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    gap: 4,
  },
  cardLabel: {
    fontSize: 14,
  },
  cardLabelLarge: {
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

export default function StepPreferences({
  weightUnit,
  setWeightUnit,
  distanceUnit,
  setDistanceUnit,
  muscleGroupSystem,
  setMuscleGroupSystem,
  theme,
  setTheme,
  errors,
}: StepPreferencesProps) {
  const borderColor = useThemeColor("border");
  const tintColor = useThemeColor("link");
  const backgroundColor = useThemeColor("background");
  const textColor = useThemeColor("foreground");
  const errorColor = useThemeColor("danger");

  return (
    <View style={stepStyles.container}>
      <View style={stepStyles.section}>
        <Text style={stepStyles.label}>
          {"Weight Unit"}
        </Text>
        <View style={stepStyles.grid2}>
          {WEIGHT_UNITS.map((unit) => {
            const isSelected = weightUnit === unit.value;
            return (
              <Pressable
                key={unit.value}
                onPress={() => setWeightUnit(unit.value)}
                style={[
                  stepStyles.card2,
                  {
                    borderColor: isSelected ? tintColor : borderColor,
                    backgroundColor: isSelected ? `${tintColor}10` : backgroundColor,
                  },
                ]}
              >
                <Text style={[stepStyles.cardLabel, { color: textColor }]}>
                  {unit.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {errors.weightUnit ? (
          <Text style={[stepStyles.error, { color: errorColor }]}>
            {errors.weightUnit}
          </Text>
        ) : null}
      </View>

      <View style={stepStyles.section}>
        <Text style={stepStyles.label}>
          {"Distance Unit"}
        </Text>
        <View style={stepStyles.grid2}>
          {DISTANCE_UNITS.map((unit) => {
            const isSelected = distanceUnit === unit.value;
            return (
              <Pressable
                key={unit.value}
                onPress={() => setDistanceUnit(unit.value)}
                style={[
                  stepStyles.card2,
                  {
                    borderColor: isSelected ? tintColor : borderColor,
                    backgroundColor: isSelected ? `${tintColor}10` : backgroundColor,
                  },
                ]}
              >
                <Text style={[stepStyles.cardLabel, { color: textColor }]}>
                  {unit.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {errors.distanceUnit ? (
          <Text style={[stepStyles.error, { color: errorColor }]}>
            {errors.distanceUnit}
          </Text>
        ) : null}
      </View>

      <View style={stepStyles.section}>
        <Text style={stepStyles.label}>
          {"Muscle Group Categorization"}
        </Text>
        <View style={{ gap: 12 }}>
          {MUSCLE_GROUP_SYSTEMS.map((sys) => {
            const isSelected = muscleGroupSystem === sys.value;
            return (
              <Pressable
                key={sys.value}
                onPress={() => setMuscleGroupSystem(sys.value)}
                style={[
                  stepStyles.cardFull,
                  {
                    borderColor: isSelected ? tintColor : borderColor,
                    backgroundColor: isSelected ? `${tintColor}10` : backgroundColor,
                  },
                ]}
              >
                <Text style={[stepStyles.cardLabelLarge, { color: textColor }]}>
                  {sys.label}
                </Text>
                <Text style={[stepStyles.cardDescription, { color: textColor }]}>
                  {sys.description}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {errors.muscleGroupSystem ? (
          <Text style={[stepStyles.error, { color: errorColor }]}>
            {errors.muscleGroupSystem}
          </Text>
        ) : null}
      </View>

      <View style={stepStyles.section}>
        <Text style={stepStyles.label}>
          {"Theme"}
        </Text>
        <View style={stepStyles.grid3}>
          {THEMES.map((t) => {
            const isSelected = theme === t.value;
            return (
              <Pressable
                key={t.value}
                onPress={() => setTheme(t.value)}
                style={[
                  stepStyles.card3,
                  {
                    borderColor: isSelected ? tintColor : borderColor,
                    backgroundColor: isSelected ? `${tintColor}10` : backgroundColor,
                  },
                ]}
              >
                <Text style={[stepStyles.cardLabel, { color: textColor }]}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {errors.theme ? (
          <Text style={[stepStyles.error, { color: errorColor }]}>
            {errors.theme}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
