// --- Input types (what we extract from DB) ---

export interface SetSnapshot {
  reps: number;
  weight: number; // in user's preferred unit
  rpe: number | null;
}

export interface ExerciseSessionSnapshot {
  date: Date;
  sets: SetSnapshot[];
  totalVolume: number; // sum of (reps * weight) across sets
  topSetWeight: number; // heaviest weight used
  topSetReps: number; // most reps in any single set
  averageRpe: number | null; // average RPE across sets, null if no RPE data
  numberOfSets: number;
}

// --- Output types ---

export type TrendStatus = "improving" | "plateau" | "declining";

export type ProgressionType =
  | "increase_weight"
  | "increase_reps"
  | "add_set"
  | "deload"
  | "maintain";

export interface ProgressionSuggestion {
  type: ProgressionType;
  message: string; // Human-readable, e.g. "Increase weight to 142.5 lbs"
  details: {
    currentValue: number;
    suggestedValue: number;
    unit: string; // "lbs", "kg", "reps", "sets"
  };
}

export interface OverloadAnalysis {
  trendStatus: TrendStatus;
  plateauCount: number;
  suggestion: ProgressionSuggestion | null;
}

// ---------------------------------------------------------------------------
// buildSessionSnapshot
// ---------------------------------------------------------------------------

/**
 * Convert raw set data into a typed session snapshot, filtering null reps/weight.
 */
export function buildSessionSnapshot(
  date: Date,
  sets: Array<{ reps: number | null; weight: number | null; rpe: number | null }>,
): ExerciseSessionSnapshot {
  const validSets = sets.filter(
    (s): s is { reps: number; weight: number; rpe: number | null } =>
      s.reps != null && s.weight != null,
  );

  const totalVolume = validSets.reduce((sum, s) => sum + s.reps * s.weight, 0);
  const topSetWeight =
    validSets.length > 0 ? Math.max(...validSets.map((s) => s.weight)) : 0;
  const topSetReps =
    validSets.length > 0 ? Math.max(...validSets.map((s) => s.reps)) : 0;
  const rpeSets = validSets.filter((s) => s.rpe != null);
  const averageRpe =
    rpeSets.length > 0
      ? rpeSets.reduce((sum, s) => sum + s.rpe!, 0) / rpeSets.length
      : null;

  return {
    date,
    sets: validSets.map((s) => ({ reps: s.reps, weight: s.weight, rpe: s.rpe })),
    totalVolume,
    topSetWeight,
    topSetReps,
    averageRpe,
    numberOfSets: validSets.length,
  };
}

// ---------------------------------------------------------------------------
// detectTrend
// ---------------------------------------------------------------------------

/**
 * Classify a comparison between two consecutive sessions.
 * Returns "improved", "declined", or "flat" based on volume and top-set weight changes.
 *
 * A change is considered "flat" if both volume and top-set weight stayed within ±2.5%.
 * "improved" requires volume > +2.5% OR top-set weight > +2.5%.
 * "declined" requires volume < -2.5% AND top-set weight did not improve.
 */
function classifyComparison(
  prev: ExerciseSessionSnapshot,
  curr: ExerciseSessionSnapshot,
): "improved" | "declined" | "flat" {
  const TOLERANCE = 0.025; // 2.5%

  const volumeChange =
    prev.totalVolume > 0
      ? (curr.totalVolume - prev.totalVolume) / prev.totalVolume
      : 0;

  const weightChange =
    prev.topSetWeight > 0
      ? (curr.topSetWeight - prev.topSetWeight) / prev.topSetWeight
      : 0;

  const volumeImproved = volumeChange > TOLERANCE;
  const volumeDeclined = volumeChange < -TOLERANCE;
  const weightImproved = weightChange > TOLERANCE;

  if (volumeImproved || weightImproved) {
    return "improved";
  }
  if (volumeDeclined && !weightImproved) {
    return "declined";
  }
  return "flat";
}

/**
 * Detect the overall trend from the last N sessions (ordered oldest-first, at least 2).
 *
 * - "improving": volume or top-set weight increased in at least 2 of last 3 comparisons
 * - "plateau": volume AND top-set weight stayed within +/- 2.5% for `plateauThreshold` consecutive sessions
 * - "declining": volume or top-set weight decreased in at least 2 of last 3 comparisons,
 *                OR average RPE > 8 for 3+ consecutive recent sessions
 */
export function detectTrend(
  sessions: ExerciseSessionSnapshot[],
  plateauThreshold: number,
): { trendStatus: TrendStatus; plateauCount: number } {
  if (sessions.length < 2) {
    return { trendStatus: "improving", plateauCount: 0 };
  }

  // Build comparison results for each consecutive pair (oldest to newest)
  const comparisons: Array<"improved" | "declined" | "flat"> = [];
  for (let i = 1; i < sessions.length; i++) {
    comparisons.push(classifyComparison(sessions[i - 1]!, sessions[i]!));
  }

  // Count consecutive flat comparisons from the most recent pair backward
  let plateauCount = 0;
  for (let i = comparisons.length - 1; i >= 0; i--) {
    if (comparisons[i] === "flat") {
      plateauCount++;
    } else {
      break;
    }
  }

  // Check RPE-based declining: avg RPE > 8 for 3+ consecutive recent sessions
  const recentSessions = sessions.slice(-3);
  const highRpeSessions = recentSessions.filter(
    (s) => s.averageRpe != null && s.averageRpe > 8,
  );
  if (recentSessions.length >= 3 && highRpeSessions.length >= 3) {
    return { trendStatus: "declining", plateauCount };
  }

  // Plateau check: at least plateauThreshold consecutive flat comparisons
  if (plateauCount >= plateauThreshold) {
    return { trendStatus: "plateau", plateauCount };
  }

  // Check last 3 comparisons for improving / declining
  const last3 = comparisons.slice(-3);
  const improvedCount = last3.filter((c) => c === "improved").length;
  const declinedCount = last3.filter((c) => c === "declined").length;

  if (improvedCount >= 2) {
    return { trendStatus: "improving", plateauCount };
  }
  if (declinedCount >= 2) {
    return { trendStatus: "declining", plateauCount };
  }

  // With fewer comparisons (e.g., exactly 2 sessions = 1 comparison), use any
  // positive signal as "improving" rather than defaulting to plateau.
  if (comparisons.length === 1) {
    if (comparisons[0] === "improved") {
      return { trendStatus: "improving", plateauCount };
    }
    if (comparisons[0] === "declined") {
      return { trendStatus: "declining", plateauCount };
    }
  }

  // Default: improving (optimistic) when no clear pattern yet and below threshold
  return { trendStatus: "improving", plateauCount };
}

// ---------------------------------------------------------------------------
// generateSuggestion
// ---------------------------------------------------------------------------

/**
 * Generate a progression suggestion based on trend status and recent session data.
 *
 * IMPROVING:
 *   - If topSetReps <= 3: suggest increasing reps (low-rep strength work)
 *   - Otherwise: suggest ~5% weight increase, rounded to nearest increment
 *
 * PLATEAU:
 *   - plateauCount >= 4: suggest deload (reduce weight by 10%)
 *   - plateauCount < 4 and < 6 sets: suggest adding 1 set
 *   - plateauCount < 4 and >= 6 sets: suggest deload (nowhere to add)
 *
 * DECLINING:
 *   - Suggest maintaining current weight and focus on form/recovery
 */
export function generateSuggestion(
  trendStatus: TrendStatus,
  plateauCount: number,
  latestSession: ExerciseSessionSnapshot,
  weightUnit: "lbs" | "kg",
): ProgressionSuggestion | null {
  const currentWeight = latestSession.topSetWeight;
  const currentSets = latestSession.numberOfSets;
  const currentReps = latestSession.topSetReps;

  if (trendStatus === "improving") {
    // For very low reps (strength work at limit), suggest reps instead of weight
    if (currentReps <= 3) {
      const suggestedReps = currentReps + 1;
      return {
        type: "increase_reps",
        message: `Add 1 more rep — aim for ${suggestedReps} reps on your top set`,
        details: {
          currentValue: currentReps,
          suggestedValue: suggestedReps,
          unit: "reps",
        },
      };
    }

    const suggestedWeight = roundToNearestIncrement(
      currentWeight * 1.05,
      weightUnit,
    );
    return {
      type: "increase_weight",
      message: `Increase weight to ${suggestedWeight} ${weightUnit}`,
      details: {
        currentValue: currentWeight,
        suggestedValue: suggestedWeight,
        unit: weightUnit,
      },
    };
  }

  if (trendStatus === "plateau") {
    if (plateauCount >= 4) {
      // Deload: reduce weight by 10%
      const deloadWeight = roundToNearestIncrement(
        currentWeight * 0.9,
        weightUnit,
      );
      return {
        type: "deload",
        message: `Take a deload — reduce weight to ${deloadWeight} ${weightUnit} to reset recovery`,
        details: {
          currentValue: currentWeight,
          suggestedValue: deloadWeight,
          unit: weightUnit,
        },
      };
    }

    if (currentSets < 6) {
      const suggestedSets = currentSets + 1;
      return {
        type: "add_set",
        message: `Add 1 more set — increase from ${currentSets} to ${suggestedSets} sets`,
        details: {
          currentValue: currentSets,
          suggestedValue: suggestedSets,
          unit: "sets",
        },
      };
    }

    // Already at 6 sets and below plateau threshold — deload
    const deloadWeight = roundToNearestIncrement(
      currentWeight * 0.9,
      weightUnit,
    );
    return {
      type: "deload",
      message: `Take a deload — reduce weight to ${deloadWeight} ${weightUnit} to break through the plateau`,
      details: {
        currentValue: currentWeight,
        suggestedValue: deloadWeight,
        unit: weightUnit,
      },
    };
  }

  // DECLINING
  return {
    type: "maintain",
    message: `Maintain current weight of ${currentWeight} ${weightUnit} and focus on consistent form`,
    details: {
      currentValue: currentWeight,
      suggestedValue: currentWeight,
      unit: weightUnit,
    },
  };
}

// ---------------------------------------------------------------------------
// analyzeProgressiveOverload
// ---------------------------------------------------------------------------

/**
 * Main entry point: given a list of recent sessions (up to 10, oldest first)
 * and user config, produce the full overload analysis.
 */
export function analyzeProgressiveOverload(
  sessions: ExerciseSessionSnapshot[],
  config: {
    plateauThreshold: number; // from user preferences, default 3
    weightUnit: "lbs" | "kg";
  },
): OverloadAnalysis {
  if (sessions.length < 2) {
    return {
      trendStatus: "improving",
      plateauCount: 0,
      suggestion: null,
    };
  }

  const { trendStatus, plateauCount } = detectTrend(sessions, config.plateauThreshold);
  const latestSession = sessions[sessions.length - 1]!;
  const suggestion = generateSuggestion(
    trendStatus,
    plateauCount,
    latestSession,
    config.weightUnit,
  );

  return { trendStatus, plateauCount, suggestion };
}

// ---------------------------------------------------------------------------
// roundToNearestIncrement
// ---------------------------------------------------------------------------

/**
 * Round a weight to the nearest practical increment.
 * - lbs: round to nearest 2.5
 * - kg: round to nearest 1.25
 */
export function roundToNearestIncrement(
  weight: number,
  unit: "lbs" | "kg",
): number {
  const increment = unit === "lbs" ? 2.5 : 1.25;
  return Math.round(weight / increment) * increment;
}
