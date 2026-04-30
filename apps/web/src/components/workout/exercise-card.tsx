import { Plus, Timer, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SuggestionBadge } from "@/components/workout/suggestion-badge";
import { useExerciseSuggestion } from "@/components/workout/use-exercise-suggestion";
import {
  calculateExerciseVolume,
  displayUnitToMeters,
  formatVolume,
  isCardioStyleExerciseType,
  metersToDisplayUnit,
} from "@src/api/lib/index";
import type { WorkoutExerciseFormData, WorkoutSetFormData } from "@src/api/lib/index";

function ExerciseSuggestionBadge({ exerciseId }: { exerciseId: string }) {
  const { suggestion, trendStatus, isLoading } = useExerciseSuggestion(exerciseId);

  if (isLoading || !trendStatus) return null;

  return (
    <SuggestionBadge
      trendStatus={trendStatus}
      suggestion={suggestion}
      compact={false}
    />
  );
}

function isTimedSet(set: WorkoutSetFormData): boolean {
  return set.durationSeconds !== undefined && set.reps === undefined;
}

function parseNumber(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}


interface ExerciseCardProps {
  exercise: WorkoutExerciseFormData;
  distanceUnit?: "mi" | "km";
  onUpdate: (updated: WorkoutExerciseFormData) => void;
  onRemove: () => void;
  onChangeExercise: () => void;
}

export function ExerciseCard({
  exercise,
  distanceUnit = "mi",
  onUpdate,
  onRemove,
  onChangeExercise,
}: ExerciseCardProps) {
  const cardioStyle = isCardioStyleExerciseType(exercise.exerciseType);

  const updateExerciseField = (
    field:
      | "rounds"
      | "workDurationSeconds"
      | "restDurationSeconds"
      | "intensity"
      | "durationSeconds"
      | "heartRate",
    value: string,
  ) => {
    const numericValue = parseNumber(value);
    onUpdate({ ...exercise, [field]: numericValue });
  };

  const updateNotes = (notes: string) => {
    onUpdate({
      ...exercise,
      notes,
    });
  };

  const updateSet = (
    index: number,
    field: "reps" | "weight" | "rpe" | "durationSeconds",
    value: string,
  ) => {
    const numValue = parseNumber(value);
    const updatedSets = [...exercise.sets];
    updatedSets[index] = { ...updatedSets[index], [field]: numValue };
    onUpdate({ ...exercise, sets: updatedSets });
  };

  const toggleSetMode = (index: number) => {
    const updatedSets = [...exercise.sets];
    const set = updatedSets[index]!;
    if (isTimedSet(set)) {
      updatedSets[index] = { ...set, durationSeconds: undefined, reps: undefined };
    } else {
      updatedSets[index] = { ...set, reps: undefined, weight: undefined, durationSeconds: 30 };
    }
    onUpdate({ ...exercise, sets: updatedSets });
  };

  const addSet = () => {
    const lastSet = exercise.sets[exercise.sets.length - 1];
    const timed = lastSet ? isTimedSet(lastSet) : false;
    const newSet: WorkoutSetFormData = {
      tempId: crypto.randomUUID(),
      setNumber: exercise.sets.length + 1,
      reps: timed ? undefined : lastSet?.reps,
      weight: timed ? undefined : lastSet?.weight,
      rpe: undefined,
      durationSeconds: timed ? lastSet?.durationSeconds : undefined,
    };
    onUpdate({ ...exercise, sets: [...exercise.sets, newSet] });
  };

  const removeSet = (index: number) => {
    if (exercise.sets.length === 1) return;
    const updatedSets = exercise.sets
      .filter((_, i) => i !== index)
      .map((set, i) => ({ ...set, setNumber: i + 1 }));
    onUpdate({ ...exercise, sets: updatedSets });
  };

  const volume = calculateExerciseVolume(exercise);
  const anyTimed = exercise.sets.some(isTimedSet);
  const anyWeighted = exercise.sets.some((set) => !isTimedSet(set));
  const mixedModes = anyTimed && anyWeighted;

  const renderCardioFields = () => {
    if (exercise.exerciseType === "cardio") {
      return (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Distance ({distanceUnit})</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder={distanceUnit === "mi" ? "3.1" : "5.0"}
                value={
                  exercise.distanceMeter != null
                    ? metersToDisplayUnit(exercise.distanceMeter, distanceUnit).toFixed(2).replace(/\.?0+$/, "")
                    : ""
                }
                onChange={(e) => {
                  const raw = parseNumber(e.target.value);
                  onUpdate({
                    ...exercise,
                    distanceMeter: raw != null ? Math.round(displayUnitToMeters(raw, distanceUnit)) : undefined,
                  });
                }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Duration (s)</label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="1800"
                value={exercise.durationSeconds ?? ""}
                onChange={(e) =>
                  updateExerciseField("durationSeconds", e.target.value)
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Avg HR (bpm)</label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="150"
                value={exercise.heartRate ?? ""}
                onChange={(e) =>
                  updateExerciseField("heartRate", e.target.value)
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Intensity (1–10)</label>
              <Input
                type="number"
                min="1"
                max="10"
                step="1"
                placeholder="7"
                value={exercise.intensity ?? ""}
                onChange={(e) =>
                  updateExerciseField("intensity", e.target.value)
                }
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Notes</label>
            <textarea
              className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Terrain, weather, perceived effort..."
              value={exercise.notes}
              onChange={(e) => updateNotes(e.target.value)}
            />
          </div>
        </div>
      );
    }

    if (exercise.exerciseType === "hiit") {
      return (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Rounds</label>
              <Input
                type="number"
                min="1"
                step="1"
                placeholder="8"
                value={exercise.rounds ?? ""}
                onChange={(e) => updateExerciseField("rounds", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Work Duration (seconds)</label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="30"
                value={exercise.workDurationSeconds ?? ""}
                onChange={(e) =>
                  updateExerciseField("workDurationSeconds", e.target.value)
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Rest Duration (seconds)</label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="60"
                value={exercise.restDurationSeconds ?? ""}
                onChange={(e) =>
                  updateExerciseField("restDurationSeconds", e.target.value)
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Intensity</label>
              <Input
                type="number"
                min="1"
                max="10"
                step="1"
                placeholder="8"
                value={exercise.intensity ?? ""}
                onChange={(e) =>
                  updateExerciseField("intensity", e.target.value)
                }
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Notes</label>
            <textarea
              className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Surface, target pace, recovery notes..."
              value={exercise.notes}
              onChange={(e) => updateNotes(e.target.value)}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium">Rounds</label>
            <Input
              type="number"
              min="1"
              step="1"
              placeholder="2"
              value={exercise.rounds ?? ""}
              onChange={(e) => updateExerciseField("rounds", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Duration Per Round (seconds)</label>
            <Input
              type="number"
              min="0"
              step="1"
              placeholder="45"
              value={exercise.durationSeconds ?? ""}
              onChange={(e) =>
                updateExerciseField("durationSeconds", e.target.value)
              }
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Notes</label>
          <textarea
            className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Areas of focus, soreness, mobility notes..."
            value={exercise.notes}
            onChange={(e) => updateNotes(e.target.value)}
          />
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <button
              onClick={onChangeExercise}
              className="text-left hover:underline"
            >
              <CardTitle>
                {exercise.exerciseName || "Select Exercise"}
              </CardTitle>
            </button>
            {exercise.exerciseId && (
              <ExerciseSuggestionBadge exerciseId={exercise.exerciseId} />
            )}
          </div>
          <div className="flex items-center gap-2">
            {!cardioStyle && volume > 0 && (
              <span className="text-sm text-muted-foreground">
                {anyTimed && !anyWeighted
                  ? `${volume}s total`
                  : `Volume: ${formatVolume(volume)}`}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={onRemove}
              title="Remove exercise"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {cardioStyle ? (
          renderCardioFields()
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[50px_1fr_1fr_1fr_32px_40px] gap-2 text-sm font-medium text-muted-foreground">
              <div>Set</div>
              <div>{mixedModes ? "Reps/Dur" : anyTimed ? "Duration (s)" : "Reps"}</div>
              <div>Weight (lbs)</div>
              <div>RPE</div>
              <div title="Toggle timed mode"><Timer className="h-4 w-4" /></div>
              <div></div>
            </div>

            {exercise.sets.map((set, index) => {
              const timed = isTimedSet(set);
              return (
                <div
                  key={set.tempId}
                  className="grid grid-cols-[50px_1fr_1fr_1fr_32px_40px] gap-2"
                >
                  <div className="flex items-center text-sm">{set.setNumber}</div>
                  {timed ? (
                    <Input
                      type="number"
                      placeholder="30"
                      min="1"
                      value={set.durationSeconds ?? ""}
                      onChange={(e) =>
                        updateSet(index, "durationSeconds", e.target.value)
                      }
                      className="h-8"
                      title="Duration in seconds"
                    />
                  ) : (
                    <Input
                      type="number"
                      placeholder="10"
                      value={set.reps ?? ""}
                      onChange={(e) => updateSet(index, "reps", e.target.value)}
                      className="h-8"
                    />
                  )}
                  <Input
                    type="number"
                    placeholder="135"
                    value={set.weight ?? ""}
                    onChange={(e) => updateSet(index, "weight", e.target.value)}
                    className="h-8"
                    disabled={timed}
                  />
                  <Input
                    type="number"
                    placeholder="7"
                    min="1"
                    max="10"
                    value={set.rpe ?? ""}
                    onChange={(e) => updateSet(index, "rpe", e.target.value)}
                    className="h-8"
                  />
                  <Button
                    variant={timed ? "secondary" : "ghost"}
                    size="icon"
                    onClick={() => toggleSetMode(index)}
                    title={timed ? "Switch to reps" : "Switch to timed"}
                    className="h-8 w-8"
                  >
                    <Timer className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeSet(index)}
                    disabled={exercise.sets.length === 1}
                    className="h-8 w-8"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}

            <Button
              variant="outline"
              size="sm"
              onClick={addSet}
              className="w-full"
            >
              <Plus className="h-4 w-4" />
              Add Set
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
