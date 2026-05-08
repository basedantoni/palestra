import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Chip } from "heroui-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

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

/** Returns a human-readable relative time string ("2 minutes ago", "never"). */
function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return "never";
  const d = date instanceof Date ? date : new Date(date);
  const diffMs = Date.now() - d.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

export default function SettingsScreen() {
  const { setTheme } = useAppTheme();
  const queryClient = useQueryClient();
  const preferencesQuery = useQuery(trpc.preferences.get.queryOptions());
  const webhookStatusQuery = useQuery({
    ...trpc.whoop.webhookStatus.queryOptions(),
    refetchInterval: (query) =>
      query.state.data?.backfill?.running ? 2000 : false,
  });
  const connectionStatusQuery = useQuery(trpc.whoop.connectionStatus.queryOptions());
  const [bannerDismissed, setBannerDismissed] = useState(false);

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
        setTheme(formData.theme);
        Alert.alert("Success", "Settings updated");
      },
      onError: (error) => {
        Alert.alert("Error", error.message || "Failed to update settings");
      },
    }),
  );

  const setAutoImportMutation = useMutation(
    trpc.whoop.setAutoImport.mutationOptions({
      onMutate: async ({ enabled }) => {
        await queryClient.cancelQueries({
          queryKey: trpc.whoop.webhookStatus.queryOptions().queryKey,
        });
        const previous = queryClient.getQueryData(
          trpc.whoop.webhookStatus.queryOptions().queryKey,
        );
        queryClient.setQueryData(
          trpc.whoop.webhookStatus.queryOptions().queryKey,
          (old: typeof webhookStatusQuery.data) =>
            old ? { ...old, autoImportEnabled: enabled } : old,
        );
        return { previous };
      },
      onError: (_err, _vars, context) => {
        if (context?.previous !== undefined) {
          queryClient.setQueryData(
            trpc.whoop.webhookStatus.queryOptions().queryKey,
            context.previous,
          );
        }
        Alert.alert("Error", "Failed to update auto-import setting");
      },
      onSettled: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.whoop.webhookStatus.queryOptions().queryKey,
        });
      },
    }),
  );

  const setNotifyOnAutoImportMutation = useMutation(
    trpc.whoop.setNotifyOnAutoImport.mutationOptions({
      onMutate: async ({ enabled }) => {
        await queryClient.cancelQueries({
          queryKey: trpc.whoop.webhookStatus.queryOptions().queryKey,
        });
        const previous = queryClient.getQueryData(
          trpc.whoop.webhookStatus.queryOptions().queryKey,
        );
        queryClient.setQueryData(
          trpc.whoop.webhookStatus.queryOptions().queryKey,
          (old: typeof webhookStatusQuery.data) =>
            old ? { ...old, notifyOnAutoImport: enabled } : old,
        );
        return { previous };
      },
      onError: (_err, _vars, context) => {
        if (context?.previous !== undefined) {
          queryClient.setQueryData(
            trpc.whoop.webhookStatus.queryOptions().queryKey,
            context.previous,
          );
        }
        Alert.alert("Error", "Failed to update notification setting");
      },
      onSettled: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.whoop.webhookStatus.queryOptions().queryKey,
        });
      },
    }),
  );

  const reregisterWebhookMutation = useMutation(
    trpc.whoop.reregisterWebhook.mutationOptions({
      onSuccess: () => {
        setBannerDismissed(true);
        queryClient.invalidateQueries({
          queryKey: trpc.whoop.webhookStatus.queryOptions().queryKey,
        });
        Alert.alert("Success", "Webhook re-registered successfully");
      },
      onError: (error) => {
        Alert.alert("Error", error.message || "Failed to re-register webhook");
      },
    }),
  );

  const stopBackfillMutation = useMutation(
    trpc.whoop.stopBackfill.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.whoop.webhookStatus.queryOptions().queryKey,
        });
      },
      onError: (error) => {
        Alert.alert("Error", error.message || "Failed to stop backfill");
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

          {/* Whoop webhook section */}
          {connectionStatusQuery.data?.connected && (
            <Card variant="secondary" className="p-4">
              <Text className="text-base font-semibold text-foreground mb-3">
                Whoop Auto-Import
              </Text>

              {/* Auto-import toggle */}
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-1 pr-4">
                  <Text className="text-sm font-medium text-foreground">
                    Auto-import workouts
                  </Text>
                  <Text className="text-xs text-muted mt-0.5">
                    Automatically import workouts when they complete on your Whoop.
                  </Text>
                </View>
                <Switch
                  value={webhookStatusQuery.data?.autoImportEnabled ?? false}
                  onValueChange={(enabled) =>
                    setAutoImportMutation.mutate({ enabled })
                  }
                  disabled={setAutoImportMutation.isPending}
                />
              </View>

              {/* Notify on auto-import toggle */}
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-1 pr-4">
                  <Text className="text-sm font-medium text-foreground">
                    Notify me on auto-import
                  </Text>
                  <Text className="text-xs text-muted mt-0.5">
                    Receive an in-app notification each time a Whoop workout is imported.
                  </Text>
                </View>
                <Switch
                  value={webhookStatusQuery.data?.notifyOnAutoImport ?? false}
                  onValueChange={(enabled) =>
                    setNotifyOnAutoImportMutation.mutate({ enabled })
                  }
                  disabled={setNotifyOnAutoImportMutation.isPending}
                />
              </View>

              {/* Backfill progress */}
              {webhookStatusQuery.data?.backfill?.running && (
                <View className="flex-row items-center justify-between mb-2 bg-muted/20 rounded-lg p-2 gap-2">
                  <View className="flex-row items-center gap-2 flex-1">
                    <ActivityIndicator size="small" />
                    <Text className="text-xs text-muted flex-1">
                      Importing {webhookStatusQuery.data.backfill.importedCount} workouts&hellip;
                    </Text>
                  </View>
                  <Button
                    onPress={() => stopBackfillMutation.mutate()}
                    isDisabled={stopBackfillMutation.isPending}
                    variant="ghost"
                    size="sm"
                  >
                    <Button.Label className="text-sm">Skip</Button.Label>
                  </Button>
                </View>
              )}

              {/* Last synced timestamp */}
              {webhookStatusQuery.data?.subscribed && (
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-xs text-muted">Last synced</Text>
                  <Text className="text-xs text-muted">
                    {formatRelativeTime(webhookStatusQuery.data.lastReceivedAt)}
                  </Text>
                </View>
              )}

              {/* Invalid subscription banner */}
              {webhookStatusQuery.data?.subscribed === false && !bannerDismissed && (
                <View className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 gap-2">
                  <Text className="text-xs text-destructive">
                    Webhook subscription is inactive. Re-register to resume auto-imports.
                  </Text>
                  <Button
                    onPress={() => reregisterWebhookMutation.mutate()}
                    isDisabled={reregisterWebhookMutation.isPending}
                    variant="ghost"
                  >
                    <Button.Label className="text-destructive text-sm">
                      {reregisterWebhookMutation.isPending ? "Registering..." : "Reregister"}
                    </Button.Label>
                  </Button>
                </View>
              )}
            </Card>
          )}
        </View>
      </ScrollView>
    </Container>
  );
}
