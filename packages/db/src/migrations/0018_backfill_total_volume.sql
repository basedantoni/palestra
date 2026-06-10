-- Data migration: backfill workout.total_volume for existing rows where it is NULL.
--
-- volumeOverTime analytics reads workout.total_volume, which was only ever
-- populated by the markdown importer. Every other write path (manual create,
-- update, TCX import, Whoop import) left it NULL, so historical workouts that
-- have weighted sets show no volume.
--
-- This recomputes total_volume from exercise_set (weight * reps) joined through
-- exercise_log, mirroring computeWorkoutTotalVolume:
--   * only sets with BOTH weight and reps non-null contribute,
--   * the result is the sum of weight * reps,
--   * workouts whose qualifying sets sum to <= 0 or that have no weighted sets at
--     all (runs, Whoop activities, cardio) are left NULL.
--
-- Idempotent-safe: only touches rows WHERE total_volume IS NULL.
UPDATE "workout" AS w
SET "total_volume" = v.total_volume
FROM (
  SELECT
    el."workout_id" AS workout_id,
    SUM(es."weight" * es."reps") AS total_volume
  FROM "exercise_set" AS es
  INNER JOIN "exercise_log" AS el ON el."id" = es."exercise_log_id"
  WHERE es."weight" IS NOT NULL
    AND es."reps" IS NOT NULL
  GROUP BY el."workout_id"
  HAVING SUM(es."weight" * es."reps") > 0
) AS v
WHERE w."id" = v.workout_id
  AND w."total_volume" IS NULL;
