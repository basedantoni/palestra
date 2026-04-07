import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { format, parseISO } from "date-fns";

import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inferWorkoutType, WORKOUT_TYPE_LABELS } from "@src/api/lib/index";
import type { Resolution } from "./resolve-step";

const WORKOUT_TYPES = [
  "weightlifting",
  "hiit",
  "cardio",
  "calisthenics",
  "yoga",
  "sports",
  "mixed",
] as const;

// Loose exercise type to handle tRPC response which uses optional fields
interface ExercisePreview {
  name: string;
  notes?: string;
  isSkipped: boolean;
  rounds?: number;
  workDurationSeconds?: number;
  restDurationSeconds?: number;
  sets: Array<{
    setNumber: number;
    reps?: number;
    weight?: number;
    rpe?: number;
    durationSeconds?: number;
  }>;
}

interface ParsedWorkoutPreview {
  date: string; // ISO date string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exercises: any[];
  isRestDay: boolean;
  rawText: string;
}

interface PreviewStepProps {
  workouts: ParsedWorkoutPreview[];
  resolutionMap: Record<string, Resolution>;
  duplicateDates: string[];
  onComplete: (importedCount: number, skippedCount: number, createdCount: number) => void;
  onBack: () => void;
}

const PAGE_SIZE = 10;

function SetLine({ set }: { set: ExercisePreview["sets"][number] }) {
  if (set.durationSeconds !== undefined && set.reps === undefined) {
    return (
      <span className="text-xs text-muted-foreground">
        {set.durationSeconds}s
        {set.rpe !== undefined && ` @ RPE ${set.rpe}`}
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground">
      {set.reps} reps
      {set.weight !== undefined && set.weight > 0 && ` @ ${set.weight}lbs`}
      {set.weight === 0 && " (BW)"}
      {set.rpe !== undefined && ` RPE ${set.rpe}`}
    </span>
  );
}

function ExerciseLine({
  ex,
  resolution,
}: {
  ex: ExercisePreview;
  resolution: Resolution | undefined;
}) {
  const resolvedName =
    resolution?.type === "existing"
      ? resolution.exerciseName
      : resolution?.type === "create"
        ? resolution.name
        : null;

  const isSkipped = resolution?.type === "skip" || ex.isSkipped;

  if (isSkipped) return null;

  return (
    <div className="text-sm space-y-0.5">
      <p className="font-medium text-xs">
        {resolvedName ?? ex.name}
        {resolvedName && resolvedName !== ex.name && (
          <span className="text-muted-foreground font-normal ml-1">
            ({ex.name})
          </span>
        )}
      </p>
      {ex.sets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {ex.sets.map((s) => (
            <SetLine key={s.setNumber} set={s} />
          ))}
        </div>
      )}
      {ex.notes && (
        <p className="text-xs text-muted-foreground italic">{ex.notes}</p>
      )}
    </div>
  );
}

export function PreviewStep({
  workouts,
  resolutionMap,
  duplicateDates,
  onComplete,
  onBack,
}: PreviewStepProps) {
  const [page, setPage] = useState(0);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [workoutTypeOverrides, setWorkoutTypeOverrides] = useState<
    Record<string, string>
  >({});
  const [committed, setCommitted] = useState(false);

  const commitMutation = useMutation(trpc.import.commit.mutationOptions());

  // Build the workout list for preview -- filter rest days
  const activeWorkouts = workouts.filter((w) => !w.isRestDay);

  // Check which dates are duplicates
  const duplicateDateSet = new Set(
    duplicateDates.map((d) => {
      try {
        return parseISO(d).toISOString().slice(0, 10);
      } catch {
        return d.slice(0, 10);
      }
    }),
  );

  const isDuplicate = (dateStr: string) => {
    try {
      return duplicateDateSet.has(parseISO(dateStr).toISOString().slice(0, 10));
    } catch {
      return false;
    }
  };

  const visibleWorkouts = activeWorkouts.filter((w) => {
    if (skipDuplicates && isDuplicate(w.date)) return false;
    return true;
  });

  const totalPages = Math.ceil(visibleWorkouts.length / PAGE_SIZE);
  const pageWorkouts = visibleWorkouts.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );

  const createdExerciseCount = Object.values(resolutionMap).filter(
    (r) => r.type === "create",
  ).length;

  const duplicateCount = activeWorkouts.filter((w) => isDuplicate(w.date)).length;

  const handleCommit = () => {
    const workoutsToSend = activeWorkouts.map((w) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inferred = inferWorkoutType(w.exercises as any);
      const workoutType =
        (workoutTypeOverrides[w.date] as typeof WORKOUT_TYPES[number]) ??
        inferred;
      return {
        date: w.date,
        workoutType,
        exercises: w.exercises,
      };
    });

    commitMutation.mutate(
      {
        workouts: workoutsToSend,
        // Resolution type has category/exerciseType as narrowed string unions -- cast is safe
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolutionMap: resolutionMap as any,
        skipDuplicateDates: skipDuplicates,
      },
      {
        onSuccess: (result) => {
          setCommitted(true);
          onComplete(
            result.importedCount,
            result.skippedCount,
            result.createdExerciseCount,
          );
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Preview Import</h2>
        <p className="text-muted-foreground text-sm">
          Review the workouts to be imported before committing.
        </p>
      </div>

      {/* Summary */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="font-semibold">{visibleWorkouts.length}</span>{" "}
              <span className="text-muted-foreground">workouts to import</span>
            </div>
            {createdExerciseCount > 0 && (
              <div>
                <span className="font-semibold">{createdExerciseCount}</span>{" "}
                <span className="text-muted-foreground">
                  new exercises to create
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Duplicate warning */}
      {duplicateCount > 0 && (
        <Card className="border-yellow-400/50">
          <CardContent className="py-3 space-y-2">
            <div className="flex items-center gap-2 text-yellow-600">
              <AlertCircle className="size-4" />
              <p className="text-sm font-medium">
                {duplicateCount} workout date
                {duplicateCount > 1 ? "s" : ""} already exist in your log
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                className={[
                  "text-xs px-3 py-1 border rounded-none transition-colors",
                  skipDuplicates
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-muted/50",
                ].join(" ")}
                onClick={() => {
                  setSkipDuplicates(true);
                  setPage(0);
                }}
              >
                Skip duplicates
              </button>
              <button
                className={[
                  "text-xs px-3 py-1 border rounded-none transition-colors",
                  !skipDuplicates
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-muted/50",
                ].join(" ")}
                onClick={() => {
                  setSkipDuplicates(false);
                  setPage(0);
                }}
              >
                Import anyway (creates duplicates)
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Commit error */}
      {commitMutation.isError && (
        <Card className="border-destructive">
          <CardContent className="py-3">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-4" />
              <p className="text-sm">
                {commitMutation.error instanceof Error
                  ? commitMutation.error.message
                  : "Import failed. Please try again."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Workout cards */}
      <div className="space-y-3">
        {pageWorkouts.map((w) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const inferred = inferWorkoutType(w.exercises as any);
          const workoutType = workoutTypeOverrides[w.date] ?? inferred;
          const duplicate = isDuplicate(w.date);

          let dateDisplay = w.date;
          try {
            dateDisplay = format(parseISO(w.date), "EEEE, MMMM d, yyyy");
          } catch {
            // keep raw string
          }

          return (
            <Card
              key={w.date}
              className={duplicate && !skipDuplicates ? "border-yellow-400/50" : ""}
            >
              <CardHeader className="py-2 px-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">{dateDisplay}</CardTitle>
                  <div className="flex items-center gap-2">
                    {duplicate && !skipDuplicates && (
                      <Badge variant="outline" className="text-yellow-600 border-yellow-400 text-xs">
                        Duplicate
                      </Badge>
                    )}
                    <Select
                      value={workoutType}
                      onValueChange={(v) => {
                        if (v) {
                          setWorkoutTypeOverrides((prev) => ({
                            ...prev,
                            [w.date]: v,
                          }));
                        }
                      }}
                    >
                      <SelectTrigger size="sm" className="w-fit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WORKOUT_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {WORKOUT_TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="py-2 px-3 space-y-1.5">
                {w.exercises
                  .filter((ex) => !ex.isSkipped)
                  .map((ex) => (
                    <ExerciseLine
                      key={ex.name}
                      ex={ex}
                      resolution={resolutionMap[ex.name]}
                    />
                  ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={commitMutation.isPending || committed}>
          Back
        </Button>
        <Button
          onClick={handleCommit}
          disabled={
            commitMutation.isPending ||
            committed ||
            visibleWorkouts.length === 0
          }
        >
          {commitMutation.isPending
            ? "Importing..."
            : `Import ${visibleWorkouts.length} Workout${visibleWorkouts.length !== 1 ? "s" : ""}`}
        </Button>
      </div>
    </div>
  );
}
