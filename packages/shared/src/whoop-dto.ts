/**
 * DTO: Whoop activity score → exercise log patch
 *
 * Accepts a Whoop activity score object (from GET /activity/workout/:id or
 * the records list) and returns the fields to write to an exercise_log row.
 *
 * Returns null for all metric fields when score_state !== 'SCORED'.
 */

export interface WhoopActivityScore {
  start: string;
  end: string;
  score_state?: string;
  score?: {
    strain?: number;
    average_heart_rate?: number;
    max_heart_rate?: number;
    distance_meter?: number;
    zone_durations?: {
      zone_zero_milli?: number;
      zone_one_milli?: number;
      zone_two_milli?: number;
      zone_three_milli?: number;
      zone_four_milli?: number;
      zone_five_milli?: number;
    };
  } | null;
}

export interface ExerciseLogPatch {
  distanceMeter: number | null;
  heartRate: number | null;
  intensity: number | null;
  durationMinutes: number | null;
  hrZoneDurations: {
    zone_zero_milli?: number;
    zone_one_milli?: number;
    zone_two_milli?: number;
    zone_three_milli?: number;
    zone_four_milli?: number;
    zone_five_milli?: number;
  } | null;
}

/**
 * Pure function that transforms a Whoop activity into an exercise log patch.
 *
 * - durationMinutes is always derived from start/end timestamps (not from score)
 *   since those timestamps are always present regardless of score_state.
 * - All score-derived fields (distanceMeter, heartRate, intensity, hrZoneDurations)
 *   return null when score_state !== 'SCORED'.
 * - intensity is strain normalized: Math.round(Math.min(strain, 21) / 21 * 100)
 */
export function whoopActivityToExerciseLog(activity: WhoopActivityScore): ExerciseLogPatch {
  const startMs = new Date(activity.start).getTime();
  const endMs = new Date(activity.end).getTime();
  const durationMinutes = Math.round((endMs - startMs) / 60_000);

  if (activity.score_state !== "SCORED") {
    return {
      distanceMeter: null,
      heartRate: null,
      intensity: null,
      durationMinutes,
      hrZoneDurations: null,
    };
  }

  const score = activity.score;

  const strain = score?.strain ?? null;
  const intensity =
    strain !== null
      ? Math.round((Math.min(strain, 21) / 21) * 100)
      : null;

  const zoneDurations = score?.zone_durations ?? null;
  const hrZoneDurations =
    zoneDurations != null
      ? {
          zone_zero_milli: zoneDurations.zone_zero_milli,
          zone_one_milli: zoneDurations.zone_one_milli,
          zone_two_milli: zoneDurations.zone_two_milli,
          zone_three_milli: zoneDurations.zone_three_milli,
          zone_four_milli: zoneDurations.zone_four_milli,
          zone_five_milli: zoneDurations.zone_five_milli,
        }
      : null;

  return {
    distanceMeter: score?.distance_meter ?? null,
    heartRate: score?.average_heart_rate ?? null,
    intensity,
    durationMinutes,
    hrZoneDurations,
  };
}
