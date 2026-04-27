import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";
import { useTheme } from "@/components/theme-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/utils/trpc";
import { env } from "@src/env/web";
import { CustomExerciseStatusBadge } from "@/components/custom-exercise-status-badge";
import { EXERCISE_CATEGORY_LABELS } from "@src/api/lib/index";
import {
  DISTANCE_UNITS,
  MUSCLE_GROUP_SYSTEMS,
  THEMES,
  WEIGHT_UNITS,
} from "@src/shared";

type SettingsFormData = {
  weightUnit: "lbs" | "kg";
  distanceUnit: "mi" | "km";
  muscleGroupSystem: "bodybuilding" | "movement_patterns";
  theme: "light" | "dark" | "auto";
  plateauThreshold: number;
};

const settingsSearchSchema = z.object({
  whoop_connected: z.boolean().optional(),
  whoop_error: z.string().optional(),
});

export const Route = createFileRoute("/settings")({
  component: RouteComponent,
  validateSearch: settingsSearchSchema,
  beforeLoad: async ({ context }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }

    const isComplete = await context.queryClient.fetchQuery(
      context.trpc.preferences.isOnboardingComplete.queryOptions(),
    );

    if (!isComplete) {
      redirect({ to: "/onboarding", throw: true });
    }

    return { session };
  },
});

function RouteComponent() {
  const search = useSearch({ from: "/settings" });
  const preferencesQuery = useQuery(trpc.preferences.get.queryOptions());
  const customExercisesQuery = useQuery(
    trpc.exercises.myCustomExercises.queryOptions(),
  );
  const whoopStatusQuery = useQuery(trpc.whoop.connectionStatus.queryOptions());
  const { setTheme } = useTheme();
  const [formData, setFormData] = useState<SettingsFormData>({
    weightUnit: "lbs",
    distanceUnit: "mi",
    muscleGroupSystem: "bodybuilding",
    theme: "dark",
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

  useEffect(() => {
    if (search.whoop_connected === true) {
      toast.success("Whoop connected successfully");
    } else if (search.whoop_error) {
      toast.error(`Whoop connection failed: ${search.whoop_error}`);
    }
  // Only run once on mount to avoid repeated toasts on re-render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const whoopDisconnectMutation = useMutation(
    trpc.whoop.disconnect.mutationOptions({
      onSuccess: () => {
        whoopStatusQuery.refetch();
        toast.success("Whoop disconnected");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to disconnect Whoop");
      },
    }),
  );

  const saveMutation = useMutation(
    trpc.preferences.upsert.mutationOptions({
      onSuccess: () => {
        setTheme(formData.theme === "auto" ? "system" : formData.theme);
        toast.success("Settings updated");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update settings");
      },
    }),
  );

  const exportMutation = useMutation(
    trpc.dataExport.generateJson.mutationOptions({
      onSuccess: (payload) => {
        const fileName = `fitness-export-${new Date().toISOString().slice(0, 10)}.json`;
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        toast.success("JSON export downloaded");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to export data");
      },
    }),
  );

  const downloadTextFile = (fileName: string, content: string, contentType: string) => {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const exportWorkoutsCsvMutation = useMutation(
    trpc.dataExport.generateCsv.mutationOptions({
      onSuccess: (payload) => {
        downloadTextFile(payload.fileName, payload.content, "text/csv;charset=utf-8");
        toast.success("Workouts CSV downloaded");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to export workouts CSV");
      },
    }),
  );

  const exportTemplatesCsvMutation = useMutation(
    trpc.dataExport.generateCsv.mutationOptions({
      onSuccess: (payload) => {
        downloadTextFile(payload.fileName, payload.content, "text/csv;charset=utf-8");
        toast.success("Templates CSV downloaded");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to export templates CSV");
      },
    }),
  );

  const handleSave = () => {
    const plateauThreshold = Number(formData.plateauThreshold);
    if (!Number.isInteger(plateauThreshold) || plateauThreshold < 1 || plateauThreshold > 20) {
      toast.error("Plateau threshold must be a whole number between 1 and 20");
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

  if (preferencesQuery.isLoading) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="text-sm text-muted-foreground">Loading settings...</div>
      </div>
    );
  }

  const customExercises = customExercisesQuery.data ?? [];

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Update your preferences after onboarding.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label className="text-base font-semibold">Weight Unit</Label>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {WEIGHT_UNITS.map((unit) => (
                <button
                  key={unit.value}
                  type="button"
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      weightUnit: unit.value as SettingsFormData["weightUnit"],
                    }))
                  }
                  className={`flex cursor-pointer items-center gap-2 border p-3 text-left transition-colors hover:bg-muted ${
                    formData.weightUnit === unit.value
                      ? "border-primary bg-primary/5"
                      : ""
                  }`}
                >
                  <span className="text-sm">{unit.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-base font-semibold">Distance Unit</Label>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {DISTANCE_UNITS.map((unit) => (
                <button
                  key={unit.value}
                  type="button"
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      distanceUnit: unit.value as SettingsFormData["distanceUnit"],
                    }))
                  }
                  className={`flex cursor-pointer items-center gap-2 border p-3 text-left transition-colors hover:bg-muted ${
                    formData.distanceUnit === unit.value
                      ? "border-primary bg-primary/5"
                      : ""
                  }`}
                >
                  <span className="text-sm">{unit.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-base font-semibold">Muscle Group Categorization</Label>
            <div className="mt-2 grid grid-cols-1 gap-3">
              {MUSCLE_GROUP_SYSTEMS.map((system) => (
                <button
                  key={system.value}
                  type="button"
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      muscleGroupSystem:
                        system.value as SettingsFormData["muscleGroupSystem"],
                    }))
                  }
                  className={`flex cursor-pointer flex-col border p-3 text-left transition-colors hover:bg-muted ${
                    formData.muscleGroupSystem === system.value
                      ? "border-primary bg-primary/5"
                      : ""
                  }`}
                >
                  <span className="text-sm font-medium">{system.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {system.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-base font-semibold">Theme</Label>
            <div className="mt-2 grid grid-cols-3 gap-3">
              {THEMES.map((theme) => (
                <button
                  key={theme.value}
                  type="button"
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      theme: theme.value as SettingsFormData["theme"],
                    }))
                  }
                  className={`flex cursor-pointer items-center justify-center border p-3 transition-colors hover:bg-muted ${
                    formData.theme === theme.value
                      ? "border-primary bg-primary/5"
                      : ""
                  }`}
                >
                  <span className="text-sm">{theme.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="plateau-threshold" className="text-base font-semibold">
              Plateau Threshold
            </Label>
            <p className="text-xs text-muted-foreground mt-1 mb-2">
              Number of consecutive flat workouts before plateau status.
            </p>
            <Input
              id="plateau-threshold"
              type="number"
              min={1}
              max={20}
              value={formData.plateauThreshold}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  plateauThreshold: Number(e.target.value),
                }))
              }
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
            <Button
              variant="outline"
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
            >
              {exportMutation.isPending ? "Exporting..." : "Export JSON"}
            </Button>
            <Button
              variant="outline"
              onClick={() => exportWorkoutsCsvMutation.mutate({ dataset: "workouts" })}
              disabled={exportWorkoutsCsvMutation.isPending}
            >
              {exportWorkoutsCsvMutation.isPending
                ? "Exporting..."
                : "Export Workouts CSV"}
            </Button>
            <Button
              variant="outline"
              onClick={() => exportTemplatesCsvMutation.mutate({ dataset: "templates" })}
              disabled={exportTemplatesCsvMutation.isPending}
            >
              {exportTemplatesCsvMutation.isPending
                ? "Exporting..."
                : "Export Templates CSV"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Integrations */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Whoop integration card */}
          <div className="flex items-start justify-between gap-4 border p-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">Whoop</span>
                {whoopStatusQuery.data?.connected && whoopStatusQuery.data.isValid ? (
                  <Badge variant="secondary" className="text-xs">Connected</Badge>
                ) : whoopStatusQuery.data?.connected && !whoopStatusQuery.data.isValid ? (
                  <Badge variant="destructive" className="text-xs">Reconnect required</Badge>
                ) : null}
              </div>
              {whoopStatusQuery.data?.connected && whoopStatusQuery.data.connectedAt ? (
                <p className="text-xs text-muted-foreground mt-1">
                  Connected since {format(new Date(whoopStatusQuery.data.connectedAt), "MMM d, yyyy")}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  Sync your Whoop workouts automatically.
                </p>
              )}
              {whoopStatusQuery.data?.connected && !whoopStatusQuery.data.isValid && (
                <p className="text-xs text-destructive mt-1">
                  Your Whoop connection expired. Please reconnect to continue syncing.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {whoopStatusQuery.data?.connected && whoopStatusQuery.data.isValid ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => whoopDisconnectMutation.mutate()}
                  disabled={whoopDisconnectMutation.isPending}
                >
                  {whoopDisconnectMutation.isPending ? "Disconnecting..." : "Disconnect"}
                </Button>
              ) : (
                <a
                  href={`${env.VITE_SERVER_URL}/api/whoop/connect`}
                  className={buttonVariants({ size: "sm" })}
                >
                  Connect
                </a>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* My Custom Exercises */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>My Custom Exercises</CardTitle>
        </CardHeader>
        <CardContent>
          {customExercisesQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : customExercises.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No custom exercises yet. Use the exercise picker in a workout to
              create one.
            </div>
          ) : (
            <div className="divide-y">
              {customExercises.map((ex) => (
                <div key={ex.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium text-sm">{ex.name}</div>
                    <div className="mt-1 flex gap-1 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        {EXERCISE_CATEGORY_LABELS[ex.category]}
                      </Badge>
                      <CustomExerciseStatusBadge status={ex.status} />
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(ex.createdAt), "MMM d, yyyy")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
