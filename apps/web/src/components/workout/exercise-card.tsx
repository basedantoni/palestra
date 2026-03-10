import { Plus, Timer, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SuggestionBadge } from "@/components/workout/suggestion-badge";
import { useExerciseSuggestion } from "@/components/workout/use-exercise-suggestion";
import { calculateExerciseVolume, formatVolume } from "@src/api/lib/index";
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

interface ExerciseCardProps {
  exercise: WorkoutExerciseFormData;
  onUpdate: (updated: WorkoutExerciseFormData) => void;
  onRemove: () => void;
  onChangeExercise: () => void;
}

export function ExerciseCard({
  exercise,
  onUpdate,
  onRemove,
  onChangeExercise,
}: ExerciseCardProps) {
  const updateSet = (
    index: number,
    field: "reps" | "weight" | "rpe" | "durationSeconds",
    value: string,
  ) => {
    const numValue = value === "" ? undefined : Number(value);
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
      .filter((_: any, i: number) => i !== index)
      .map((set: any, i: number) => ({ ...set, setNumber: i + 1 }));
    onUpdate({ ...exercise, sets: updatedSets });
  };

  const volume = calculateExerciseVolume(exercise);
  const anyTimed = exercise.sets.some(isTimedSet);
  const anyWeighted = exercise.sets.some((s) => !isTimedSet(s));
  const mixedModes = anyTimed && anyWeighted;

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
            {volume > 0 && (
              <span className="text-sm text-muted-foreground">
                {anyTimed && !anyWeighted ? `${volume}s total` : `Volume: ${formatVolume(volume)}`}
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
        <div className="space-y-2">
          {/* Column headers */}
          <div className="grid grid-cols-[50px_1fr_1fr_1fr_32px_40px] gap-2 text-sm font-medium text-muted-foreground">
            <div>Set</div>
            <div>{mixedModes ? "Reps/Dur" : anyTimed ? "Duration (s)" : "Reps"}</div>
            <div>Weight (lbs)</div>
            <div>RPE</div>
            <div title="Toggle timed mode"><Timer className="h-4 w-4" /></div>
            <div></div>
          </div>

          {exercise.sets.map((set: any, index: number) => {
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
                    onChange={(e) => updateSet(index, "durationSeconds", e.target.value)}
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
      </CardContent>
    </Card>
  );
}
