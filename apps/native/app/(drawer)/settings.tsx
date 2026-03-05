import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Card, Chip } from "heroui-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Container } from "@/components/container";
import { useAppTheme } from "@/contexts/app-theme-context";
import { trpc } from "@/utils/trpc";
import {
  DISTANCE_UNITS,
  MUSCLE_GROUP_SYSTEMS,
  THEMES,
  WEIGHT_UNITS,
} from "@src/shared";

type NativeSettingsFormData = {
  weightUnit: "lbs" | "kg";
  distanceUnit: "mi" | "km";
  muscleGroupSystem: "bodybuilding" | "movement_patterns";
  theme: "light" | "dark" | "auto";
  plateauThreshold: number;
};

export default function SettingsScreen() {
  const { setTheme } = useAppTheme();
  const preferencesQuery = useQuery(trpc.preferences.get.queryOptions());

  const [formData, setFormData] = useState<NativeSettingsFormData>({
    weightUnit: "lbs",
    distanceUnit: "mi",
    muscleGroupSystem: "bodybuilding",
    theme: "auto",
    plateauThreshold: 3,
  });

  useEffect(() => {
    const preferences = preferencesQuery.data;
    if (!preferences) return;
    setFormData({
      weightUnit: preferences.weightUnit,
      distanceUnit: preferences.distanceUnit,
      muscleGroupSystem: preferences.muscleGroupSystem,
      theme: preferences.theme,
      plateauThreshold: preferences.plateauThreshold,
    });
  }, [preferencesQuery.data]);

  const saveMutation = useMutation(
    trpc.preferences.upsert.mutationOptions({
      onSuccess: () => {
        if (formData.theme === "light" || formData.theme === "dark") {
          setTheme(formData.theme);
        }
        Alert.alert("Success", "Settings updated");
      },
      onError: (error) => {
        Alert.alert("Error", error.message || "Failed to update settings");
      },
    }),
  );

  const handleSave = () => {
    const plateauThreshold = Number(formData.plateauThreshold);
    if (!Number.isInteger(plateauThreshold) || plateauThreshold < 1 || plateauThreshold > 20) {
      Alert.alert("Invalid Input", "Plateau threshold must be a whole number between 1 and 20.");
      return;
    }
    saveMutation.mutate({
      weightUnit: formData.weightUnit,
      distanceUnit: formData.distanceUnit,
      muscleGroupSystem: formData.muscleGroupSystem,
      theme: formData.theme,
      plateauThreshold,
      onboardingCompleted: true,
    });
  };

  return (
    <Container className="flex-1">
      <ScrollView className="flex-1" contentInsetAdjustmentBehavior="automatic">
        <View className="p-6 gap-4">
          <Text className="text-2xl font-bold text-foreground">Settings</Text>
          <Text className="text-sm text-muted">
            Update your preferences after onboarding.
          </Text>

          <Card variant="secondary" className="p-4">
            <Text className="text-base font-semibold text-foreground mb-3">
              Weight Unit
            </Text>
            <View className="flex-row gap-2">
              {WEIGHT_UNITS.map((unit) => (
                <Pressable
                  key={unit.value}
                  onPress={() =>
                    setFormData((prev) => ({
                      ...prev,
                      weightUnit: unit.value as NativeSettingsFormData["weightUnit"],
                    }))
                  }
                >
                  <Chip
                    variant={formData.weightUnit === unit.value ? "primary" : "secondary"}
                  >
                    <Chip.Label>{unit.label}</Chip.Label>
                  </Chip>
                </Pressable>
              ))}
            </View>
          </Card>

          <Card variant="secondary" className="p-4">
            <Text className="text-base font-semibold text-foreground mb-3">
              Distance Unit
            </Text>
            <View className="flex-row gap-2">
              {DISTANCE_UNITS.map((unit) => (
                <Pressable
                  key={unit.value}
                  onPress={() =>
                    setFormData((prev) => ({
                      ...prev,
                      distanceUnit: unit.value as NativeSettingsFormData["distanceUnit"],
                    }))
                  }
                >
                  <Chip
                    variant={formData.distanceUnit === unit.value ? "primary" : "secondary"}
                  >
                    <Chip.Label>{unit.label}</Chip.Label>
                  </Chip>
                </Pressable>
              ))}
            </View>
          </Card>

          <Card variant="secondary" className="p-4">
            <Text className="text-base font-semibold text-foreground mb-3">
              Muscle Group Categorization
            </Text>
            <View className="gap-2">
              {MUSCLE_GROUP_SYSTEMS.map((system) => (
                <Pressable
                  key={system.value}
                  onPress={() =>
                    setFormData((prev) => ({
                      ...prev,
                      muscleGroupSystem:
                        system.value as NativeSettingsFormData["muscleGroupSystem"],
                    }))
                  }
                  className={
                    formData.muscleGroupSystem === system.value
                      ? "border border-primary rounded-lg p-3 bg-primary/5"
                      : "border border-border rounded-lg p-3"
                  }
                >
                  <Text className="text-sm font-medium text-foreground">
                    {system.label}
                  </Text>
                  <Text className="text-xs text-muted mt-1">
                    {system.description}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Card>

          <Card variant="secondary" className="p-4">
            <Text className="text-base font-semibold text-foreground mb-3">Theme</Text>
            <View className="flex-row gap-2">
              {THEMES.map((themeOption) => (
                <Pressable
                  key={themeOption.value}
                  onPress={() =>
                    setFormData((prev) => ({
                      ...prev,
                      theme: themeOption.value as NativeSettingsFormData["theme"],
                    }))
                  }
                >
                  <Chip
                    variant={formData.theme === themeOption.value ? "primary" : "secondary"}
                  >
                    <Chip.Label>{themeOption.label}</Chip.Label>
                  </Chip>
                </Pressable>
              ))}
            </View>
          </Card>

          <Card variant="secondary" className="p-4">
            <Text className="text-base font-semibold text-foreground mb-2">
              Plateau Threshold
            </Text>
            <Text className="text-xs text-muted mb-2">
              Number of consecutive flat workouts before plateau status.
            </Text>
            <TextInput
              className="border border-border rounded-lg px-3 py-2 text-foreground bg-background"
              keyboardType="number-pad"
              value={String(formData.plateauThreshold)}
              onChangeText={(text) => {
                const parsed = Number(text);
                setFormData((prev) => ({
                  ...prev,
                  plateauThreshold: Number.isNaN(parsed) ? 0 : parsed,
                }));
              }}
              placeholder="3"
              placeholderTextColor="#999"
            />
          </Card>

          <Button onPress={handleSave} isDisabled={saveMutation.isPending}>
            <Button.Label>
              {saveMutation.isPending ? "Saving..." : "Save Settings"}
            </Button.Label>
          </Button>
        </View>
      </ScrollView>
    </Container>
  );
}
