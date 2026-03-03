import React, { useState } from "react";
import { View, StyleSheet, Pressable, Text } from "react-native";
import { TextField, useThemeColor } from "heroui-native";
import { GENDERS } from "@src/shared";

interface StepMetricsProps {
  gender?: string;
  setGender: (gender?: string) => void;
  birthYear?: number;
  setBirthYear: (year?: number) => void;
  heightCm?: number;
  setHeightCm: (height?: number) => void;
  weightKg?: number;
  setWeightKg: (weight?: number) => void;
  weightUnit: string;
  distanceUnit: string;
  errors: {
    gender?: string;
    birthYear?: string;
    heightCm?: string;
    weightKg?: string;
  };
}

const stepStyles = StyleSheet.create({
  container: {
    gap: 24,
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 8,
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
    gap: 12,
  },
  card: {
    flexBasis: "47%",
    flexGrow: 0,
    flexShrink: 0,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  cardLabel: {
    fontSize: 14,
  },
  inputWrapper: {
    flex: 1,
  },
  error: {
    fontSize: 12,
    marginTop: 4,
  },
});

export default function StepMetrics({
  gender,
  setGender,
  birthYear,
  setBirthYear,
  heightCm,
  setHeightCm,
  weightKg,
  setWeightKg,
  weightUnit,
  distanceUnit,
  errors,
}: StepMetricsProps) {
  const borderColor = useThemeColor("border");
  const tintColor = useThemeColor("link");
  const backgroundColor = useThemeColor("background");
  const textColor = useThemeColor("foreground");
  const errorColor = useThemeColor("danger");

  // Conversion functions (keep decimals for smooth input)
  const cmToInches = (cm: number) => Math.round(cm * 0.393701 * 10) / 10;
  const inchesToCm = (inches: number) => Math.round(inches * 2.54 * 10) / 10;
  const kgToLbs = (kg: number) => Math.round(kg * 2.20462 * 10) / 10;
  const lbsToKg = (lbs: number) => Math.round(lbs / 2.20462 * 10) / 10;

  // Local state for user input (prevents conversion on every keystroke)
  const initialHeight = heightCm
    ? (distanceUnit === "mi" ? cmToInches(heightCm) : heightCm).toString()
    : "";
  const initialWeight = weightKg
    ? (weightUnit === "lbs" ? kgToLbs(weightKg) : weightKg).toString()
    : "";
  const [heightInput, setHeightInput] = useState(initialHeight);
  const [weightInput, setWeightInput] = useState(initialWeight);

  // Height unit label and placeholder
  const heightUnit = distanceUnit === "mi" ? "in" : "cm";
  const heightPlaceholder = distanceUnit === "mi" ? "70" : "175";

  // Weight unit label and placeholder
  const weightPlaceholder = weightUnit === "lbs" ? "165" : "75";

  return (
    <View style={stepStyles.container}>
      <Text style={[stepStyles.subtitle, { color: textColor }]}>
        {"This information helps personalize your experience. All fields are optional."}
      </Text>

      <View style={stepStyles.section}>
        <Text style={stepStyles.label}>
          {"Gender"}
        </Text>
        <View style={stepStyles.grid2}>
          {GENDERS.map((g) => {
            const isSelected = gender === g.value;
            return (
              <Pressable
                key={g.value}
                onPress={() => setGender(g.value)}
                style={[
                  stepStyles.card,
                  {
                    borderColor: isSelected ? tintColor : borderColor,
                    backgroundColor: isSelected ? `${tintColor}10` : backgroundColor,
                  },
                ]}
              >
                <Text style={[stepStyles.cardLabel, { color: textColor }]}>
                  {g.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {errors.gender ? (
          <Text style={[stepStyles.error, { color: errorColor }]}>
            {errors.gender}
          </Text>
        ) : null}
      </View>

      <View style={stepStyles.grid3}>
        <View style={stepStyles.inputWrapper}>
          <TextField>
            <TextField.Label>{"Birth Year"}</TextField.Label>
            <TextField.Input
              value={birthYear?.toString() ?? ""}
              onChangeText={(text) => {
                const val = text === "" ? undefined : Number(text);
                setBirthYear(val);
              }}
              placeholder="1990"
              keyboardType="numeric"
            />
          </TextField>
          {errors.birthYear ? (
            <Text style={[stepStyles.error, { color: errorColor }]}>
              {errors.birthYear}
            </Text>
          ) : null}
        </View>

        <View style={stepStyles.inputWrapper}>
          <TextField>
            <TextField.Label>{`Height (${heightUnit})`}</TextField.Label>
            <TextField.Input
              value={heightInput}
              onChangeText={setHeightInput}
              onBlur={() => {
                if (heightInput === "") {
                  setHeightCm(undefined);
                } else {
                  const inputVal = Number(heightInput);
                  // Convert to cm for storage
                  const cmVal = distanceUnit === "mi" ? inchesToCm(inputVal) : inputVal;
                  setHeightCm(cmVal);
                }
              }}
              placeholder={heightPlaceholder}
              keyboardType="numeric"
            />
          </TextField>
          {errors.heightCm ? (
            <Text style={[stepStyles.error, { color: errorColor }]}>
              {errors.heightCm}
            </Text>
          ) : null}
        </View>

        <View style={stepStyles.inputWrapper}>
          <TextField>
            <TextField.Label>{`Weight (${weightUnit})`}</TextField.Label>
            <TextField.Input
              value={weightInput}
              onChangeText={setWeightInput}
              onBlur={() => {
                if (weightInput === "") {
                  setWeightKg(undefined);
                } else {
                  const inputVal = Number(weightInput);
                  // Convert to kg for storage
                  const kgVal = weightUnit === "lbs" ? lbsToKg(inputVal) : inputVal;
                  setWeightKg(kgVal);
                }
              }}
              placeholder={weightPlaceholder}
              keyboardType="numeric"
            />
          </TextField>
          {errors.weightKg ? (
            <Text style={[stepStyles.error, { color: errorColor }]}>
              {errors.weightKg}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
