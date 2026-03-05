import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExercisePicker } from "@/components/workout/exercise-picker";
import {
  apiTemplateToFormData,
  templateFormToApiInput,
  WORKOUT_TYPE_LABELS,
} from "@src/api/lib/index";
import type { TemplateFormData } from "@src/api/lib/index";

export const Route = createFileRoute("/templates/$templateId")({
  component: RouteComponent,
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
  const { templateId } = Route.useParams();
  const queryClient = useQueryClient();
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [formData, setFormData] = useState<TemplateFormData | null>(null);

  const { data: template, isLoading } = useQuery(
    trpc.templates.get.queryOptions({ id: templateId }),
  );
  const { data: exercises } = useQuery(trpc.exercises.list.queryOptions());

  const exerciseNameById = useMemo(() => {
    const entries = (exercises ?? []).map((exercise) => [exercise.id, exercise.name]);
    return Object.fromEntries(entries);
  }, [exercises]);

  useEffect(() => {
    if (template) {
      setFormData(apiTemplateToFormData(template as any, exerciseNameById));
    }
  }, [template, exerciseNameById]);

  const updateTemplate = useMutation(
    trpc.templates.update.mutationOptions({
      onSuccess: async () => {
        toast.success("Template updated");
        await queryClient.invalidateQueries();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update template");
      },
    }),
  );

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="text-sm text-muted-foreground">Loading template...</div>
      </div>
    );
  }

  if (!template || !formData) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="text-sm text-muted-foreground">Template not found.</div>
      </div>
    );
  }

  const isEditable = !template.isSystemTemplate;

  const handleSelectExercise = (exercise: { id: string; name: string }) => {
    if (!isEditable) return;
    setFormData({
      ...formData,
      exercises: [
        ...formData.exercises,
        {
          tempId: crypto.randomUUID(),
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          order: formData.exercises.length,
          defaultSets: 3,
        },
      ],
    });
    setShowExercisePicker(false);
  };

  const handleRemoveExercise = (index: number) => {
    if (!isEditable) return;
    const exercises = formData.exercises
      .filter((_, i) => i !== index)
      .map((exercise, i) => ({ ...exercise, order: i }));
    setFormData({ ...formData, exercises });
  };

  const handleSave = () => {
    if (!isEditable) return;
    const input = templateFormToApiInput(formData);
    updateTemplate.mutate({
      id: templateId,
      ...input,
    });
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Edit Template</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isEditable
              ? "Update template details and exercise list."
              : "System templates are read-only."}
          </p>
        </div>
        {isEditable && (
          <Button onClick={handleSave} disabled={updateTemplate.isPending}>
            {updateTemplate.isPending ? "Saving..." : "Save Template"}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Template Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="template-name">Name</Label>
            <Input
              id="template-name"
              value={formData.name}
              disabled={!isEditable}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="template-type">Workout Type</Label>
            <select
              id="template-type"
              disabled={!isEditable}
              className="mt-2 w-full rounded border bg-background px-3 py-2 text-sm"
              value={formData.workoutType}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  workoutType: e.target.value as TemplateFormData["workoutType"],
                })
              }
            >
              {Object.entries(WORKOUT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="template-notes">Notes</Label>
            <textarea
              id="template-notes"
              disabled={!isEditable}
              className="mt-2 w-full rounded border bg-background px-3 py-2 text-sm"
              rows={3}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exercises</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {formData.exercises.length === 0 ? (
            <p className="text-sm text-muted-foreground">No exercises added yet.</p>
          ) : (
            formData.exercises.map((exercise, index) => (
              <div
                key={exercise.tempId}
                className="rounded border p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{exercise.exerciseName}</div>
                  <div className="text-xs text-muted-foreground">
                    Exercise {index + 1}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Label htmlFor={`default-sets-${exercise.tempId}`}>Sets</Label>
                  <Input
                    id={`default-sets-${exercise.tempId}`}
                    type="number"
                    className="w-20"
                    disabled={!isEditable}
                    value={exercise.defaultSets ?? ""}
                    onChange={(e) => {
                      const value = e.target.value === "" ? undefined : Number(e.target.value);
                      const exercises = [...formData.exercises];
                      exercises[index] = { ...exercise, defaultSets: value };
                      setFormData({ ...formData, exercises });
                    }}
                  />
                  {isEditable && (
                    <Button
                      variant="outline"
                      onClick={() => handleRemoveExercise(index)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}

          {isEditable && (
            <Button variant="outline" onClick={() => setShowExercisePicker(true)}>
              Add Exercise
            </Button>
          )}
        </CardContent>
      </Card>

      <ExercisePicker
        open={showExercisePicker}
        onOpenChange={setShowExercisePicker}
        onSelect={handleSelectExercise}
      />
    </div>
  );
}
