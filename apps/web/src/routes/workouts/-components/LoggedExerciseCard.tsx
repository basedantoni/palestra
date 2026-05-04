import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatVolume,
  metersToDisplayUnit,
  getEffectiveDurationSeconds,
} from "@src/api/lib/index";

interface Set {
  id: string;
  setNumber: number;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
}

interface Log {
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
  sets: Set[];
  timedSets?: Array<{ durationSeconds: number | null }> | null;
  exercise?: {
    exerciseType?: string | null;
  } | null;
}

interface LoggedExerciseCardProps {
  log: Log;
  distanceUnit: "mi" | "km";
}

function formatLoggedDuration(seconds: number | null): string {
  if (seconds == null) return "-";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatLoggedPace(
  distanceMeter: number | null,
  durationSeconds: number | null,
  distanceUnit: "mi" | "km",
): string {
  if (
    !distanceMeter ||
    !durationSeconds ||
    distanceMeter <= 0 ||
    durationSeconds <= 0
  )
    return "-";
  const displayDist = metersToDisplayUnit(distanceMeter, distanceUnit);
  const paceMinPerUnit = durationSeconds / 60 / displayDist;
  const mins = Math.floor(paceMinPerUnit);
  const secs = Math.round((paceMinPerUnit - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")} /${distanceUnit}`;
}

export function LoggedExerciseCard({ log, distanceUnit }: LoggedExerciseCardProps) {
  const exerciseType = log.exercise?.exerciseType;
  const cardioStyle =
    exerciseType === "cardio" ||
    exerciseType === "hiit" ||
    exerciseType === "mobility";
  const exerciseVolume = log.sets.reduce(
    (sum, set) => sum + (set.reps ?? 0) * (set.weight ?? 0),
    0,
  );

  return (
    <Card key={log.id}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{log.exerciseName}</CardTitle>
          {exerciseVolume > 0 && (
            <span className="text-sm text-muted-foreground">
              Volume: {formatVolume(exerciseVolume)}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {cardioStyle ? (
          <div className="grid gap-3 text-sm md:grid-cols-2">
            {exerciseType === "cardio" && (
              <>
                <div>
                  <div className="text-muted-foreground">Distance</div>
                  <div>
                    {log.distanceMeter != null
                      ? `${metersToDisplayUnit(log.distanceMeter, distanceUnit).toFixed(2)} ${distanceUnit}`
                      : "-"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Duration</div>
                  <div>
                    {formatLoggedDuration(
                      getEffectiveDurationSeconds(log as any),
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Pace</div>
                  <div>
                    {formatLoggedPace(
                      log.distanceMeter,
                      getEffectiveDurationSeconds(log as any),
                      distanceUnit,
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Heart Rate</div>
                  <div>{log.heartRate ?? "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Intensity</div>
                  <div>{log.intensity ?? "-"}</div>
                </div>
              </>
            )}
            {exerciseType === "hiit" && (
              <>
                <div>
                  <div className="text-muted-foreground">Rounds</div>
                  <div>{log.rounds ?? "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Work Duration</div>
                  <div>{formatLoggedDuration(log.workDurationSeconds)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Rest Duration</div>
                  <div>{formatLoggedDuration(log.restDurationSeconds)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Intensity</div>
                  <div>{log.intensity ?? "-"}</div>
                </div>
              </>
            )}
            {exerciseType === "mobility" && (
              <>
                <div>
                  <div className="text-muted-foreground">Rounds</div>
                  <div>{log.rounds ?? "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Duration Per Round</div>
                  <div>{formatLoggedDuration(log.durationSeconds)}</div>
                </div>
              </>
            )}
          </div>
        ) : log.sets.length > 0 ? (
          <div className="space-y-1">
            <div className="grid grid-cols-[50px_1fr_1fr_1fr] gap-2 text-sm font-medium text-muted-foreground">
              <div>Set</div>
              <div>Reps</div>
              <div>Weight</div>
              <div>RPE</div>
            </div>
            {log.sets.map((set) => (
              <div
                key={set.id}
                className="grid grid-cols-[50px_1fr_1fr_1fr] gap-2 text-sm"
              >
                <div>{set.setNumber}</div>
                <div>{set.reps ?? "-"}</div>
                <div>{set.weight ? `${set.weight} lbs` : "-"}</div>
                <div>{set.rpe ?? "-"}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No sets recorded</div>
        )}
        {log.notes && (
          <div className="mt-3 text-sm">
            <span className="font-medium">Notes:</span> {log.notes}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
