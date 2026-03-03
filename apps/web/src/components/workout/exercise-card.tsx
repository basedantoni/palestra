import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SuggestionBadge } from "@/components/workout/suggestion-badge";
import { useExerciseSuggestion } from "@/components/workout/use-exercise-suggestion";
import { calculateExerciseVolume, formatVolume } from "@src/api/lib/index";
import type { WorkoutExerciseFormData } from "@src/api/lib/index";

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
    field: "reps" | "weight" | "rpe",
    value: string,
  ) => {
    const numValue = value === "" ? undefined : Number(value);
    const updatedSets = [...exercise.sets];
    updatedSets[index] = { ...updatedSets[index], [field]: numValue };
    onUpdate({ ...exercise, sets: updatedSets });
  };

  const addSet = () => {
    const lastSet = exercise.sets[exercise.sets.length - 1];
    const newSet = {
      tempId: crypto.randomUUID(),
      setNumber: exercise.sets.length + 1,
      reps: lastSet?.reps,
      weight: lastSet?.weight,
      rpe: undefined,
    };
    onUpdate({ ...exercise, sets: [...exercise.sets, newSet] });
  };

  const removeSet = (index: number) => {
    if (exercise.sets.length === 1) return; // Keep at least one set
    const updatedSets = exercise.sets
      .filter((_: any, i: number) => i !== index)
      .map((set: any, i: number) => ({ ...set, setNumber: i + 1 }));
    onUpdate({ ...exercise, sets: updatedSets });
  };

  const volume = calculateExerciseVolume(exercise);

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
                Volume: {formatVolume(volume)}
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
        {/* Sets Table */}
        <div className="space-y-2">
          <div className="grid grid-cols-[50px_1fr_1fr_1fr_40px] gap-2 text-sm font-medium text-muted-foreground">
            <div>Set</div>
            <div>Reps</div>
            <div>Weight (lbs)</div>
            <div>RPE</div>
            <div></div>
          </div>

          {exercise.sets.map((set: any, index: number) => (
            <div
              key={set.tempId}
              className="grid grid-cols-[50px_1fr_1fr_1fr_40px] gap-2"
            >
              <div className="flex items-center text-sm">{set.setNumber}</div>
              <Input
                type="number"
                placeholder="10"
                value={set.reps ?? ""}
                onChange={(e) => updateSet(index, "reps", e.target.value)}
                className="h-8"
              />
              <Input
                type="number"
                placeholder="135"
                value={set.weight ?? ""}
                onChange={(e) => updateSet(index, "weight", e.target.value)}
                className="h-8"
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
                variant="ghost"
                size="icon"
                onClick={() => removeSet(index)}
                disabled={exercise.sets.length === 1}
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

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
