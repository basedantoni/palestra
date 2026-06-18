/**
 * Whoop activity DTO — single source for the API-side activity shape and the
 * pure activity→exercise-log transform.
 *
 * Extracted into its own module so both the webhook processor and the backfill
 * importer (and the shared upsert helper) can import these without creating a
 * circular dependency between whoop-webhook.ts and whoop-backfill.ts.
 *
 * The pure transform `whoopActivityToExerciseLog` and its input type
 * `WhoopActivityScore` remain the source-of-truth in `@life-tracker/shared`; we re-export
 * them here so callers have one place to import everything activity-related.
 */

export {
  whoopActivityToExerciseLog,
  type WhoopActivityScore,
  type ExerciseLogPatch,
} from "@life-tracker/shared";

/**
 * Full Whoop workout activity detail, as returned by
 * GET /activity/workout/:id and the records list endpoint.
 *
 * Superset of `WhoopActivityScore` (adds `id`, `sport_id`, `sport_name`) used by
 * the import paths that need to create/resolve workouts.
 */
export interface WhoopActivityDetail {
  id: string;
  start: string;
  end: string;
  sport_id: number;
  sport_name: string;
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
