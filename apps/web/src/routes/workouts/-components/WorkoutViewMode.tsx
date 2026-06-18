import { format } from "date-fns";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  formatVolume,
  getEffectiveDurationSeconds,
} from "@life-tracker/api/lib/index";
import type { HrZoneDurations } from "@life-tracker/shared";

import { LoggedExerciseCard } from "./LoggedExerciseCard";
import { WhoopSection } from "./WhoopSection";

// Mirror the shape returned by the workouts.get query
interface WorkoutLog {
  id: string;
  exerciseName: string;
  distanceMeter: number | null;
  durationSeconds: number | null;
  heartRate: number | null;
  intensity: number | null;
  rounds: number | null;
  workDurationSeconds: number | null;
  restDurationSeconds: number | null;
  notes: string | null;
  sets: Array<{
    id: string;
    setNumber: number;
    reps: number | null;
    weight: number | null;
    rpe: number | null;
  }>;
  timedSets?: Array<{ durationSeconds: number | null }> | null;
  hrZoneDurations?: HrZoneDurations | null;
  exercise?: {
    exerciseType?: string | null;
    cardioSubtype?: string | null;
  } | null;
}

interface Workout {
  id: string;
  date: string | Date;
  totalVolume: number | null;
  notes: string | null;
  source: string | null;
  whoopActivityId: string | null | undefined;
  logs: WorkoutLog[];
}

export interface WorkoutViewModeProps {
  workout: Workout;
  distanceUnit: "mi" | "km";
}

export function WorkoutViewMode({
  workout,
  distanceUnit,
}: WorkoutViewModeProps) {
  // Find the first running log for Whoop section
  const firstRunningLog =
    workout.logs.find((log) => log.exercise?.cardioSubtype === "running") ??
    null;

  const hasRunningExercise = !!firstRunningLog;

  const whoopRunningLog = firstRunningLog
    ? {
        distanceMeter: firstRunningLog.distanceMeter,
        durationSeconds: getEffectiveDurationSeconds(firstRunningLog as any),
        heartRate: firstRunningLog.heartRate,
        intensity: firstRunningLog.intensity,
        hrZoneDurations: (firstRunningLog as any).hrZoneDurations ?? null,
      }
    : null;

  const workoutDateStr = format(new Date(workout.date), "yyyy-MM-dd");

  return (
    <>
      {/* Summary */}
      {workout.totalVolume && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6">
              <div>
                <div className="text-sm text-muted-foreground">
                  Total Volume
                </div>
                <div className="text-2xl font-bold">
                  {formatVolume(workout.totalVolume)}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Exercises</div>
                <div className="text-2xl font-bold">{workout.logs.length}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Separator className="my-6" />

      {/* Exercises */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Exercises</h2>
        {workout.logs.map((log) => (
          <LoggedExerciseCard
            key={log.id}
            log={log as any}
            distanceUnit={distanceUnit}
          />
        ))}
      </div>

      {/* Whoop section — only for workouts with running exercises */}
      {hasRunningExercise && (
        <WhoopSection
          workoutId={workout.id}
          workoutDate={workoutDateStr}
          whoopActivityId={workout.whoopActivityId}
          runningLog={whoopRunningLog}
          distanceUnit={distanceUnit}
        />
      )}

      {/* Workout Notes */}
      {workout.notes && (
        <>
          <Separator className="my-6" />
          <div>
            <h2 className="mb-2 text-lg font-semibold">Workout Notes</h2>
            <p className="text-sm text-muted-foreground">{workout.notes}</p>
          </div>
        </>
      )}
    </>
  );
}
