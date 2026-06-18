import { getEffectiveDurationSeconds } from "@life-tracker/api/lib/index";
import type { HrZoneDurations } from "@life-tracker/shared";

interface WorkoutLog {
  distanceMeter: number | null;
  durationSeconds: number | null;
  heartRate: number | null;
  intensity: number | null;
  hrZoneDurations?: HrZoneDurations | null;
  timedSets?: Array<{ durationSeconds: number | null }> | null;
  exercise?: { cardioSubtype?: string | null } | null;
}

interface WorkoutWithLogs {
  logs: WorkoutLog[];
}

export interface RunningLogResult {
  distanceMeter: number | null;
  durationSeconds: number | null;
  heartRate: number | null;
  intensity: number | null;
  hrZoneDurations: HrZoneDurations | null;
}

/**
 * Returns the first running exercise log's metrics (for Whoop display),
 * or null if the workout has no running exercise log.
 */
export function useWorkoutFirstRunningLog(
  workout: WorkoutWithLogs,
): { log: WorkoutLog; result: RunningLogResult } | null {
  const firstRunningLog =
    workout.logs.find((log) => log.exercise?.cardioSubtype === "running") ??
    null;

  if (!firstRunningLog) return null;

  return {
    log: firstRunningLog,
    result: {
      distanceMeter: firstRunningLog.distanceMeter,
      durationSeconds: getEffectiveDurationSeconds(firstRunningLog as any),
      heartRate: firstRunningLog.heartRate,
      intensity: firstRunningLog.intensity,
      hrZoneDurations: (firstRunningLog as any).hrZoneDurations ?? null,
    },
  };
}
